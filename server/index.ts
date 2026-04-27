import express from 'express'
import cors from 'cors'
import multer from 'multer'
import cookieParser from 'cookie-parser'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { getSettings, saveSettings } from './settings'
import { runOCR } from './ocr-service'
import { translateParagraphs, getSupportedLanguages } from './translator-service'
import { exportToPDF, exportToWord, exportToJSON, createTranslatedPDF } from './exporter'

const app = express()
const PORT = process.env.PORT || 3001

// Auth configuration — supports multiple users via AUTH_USERS=user1:pass1,user2:pass2
// Also supports single user via AUTH_USERNAME + AUTH_PASSWORD (legacy)
const buildUserMap = (): Map<string, string> => {
  const map = new Map<string, string>()
  const multi = process.env.AUTH_USERS
  if (multi) {
    for (const entry of multi.split(',')) {
      const colonIdx = entry.indexOf(':')
      if (colonIdx > 0) {
        const u = entry.slice(0, colonIdx).trim()
        const p = entry.slice(colonIdx + 1).trim()
        if (u && p) map.set(u, p)
      }
    }
  }
  // Legacy single-user fallback
  const singleUser = process.env.AUTH_USERNAME
  const singlePass = process.env.AUTH_PASSWORD
  if (singleUser && singlePass && !map.has(singleUser)) {
    map.set(singleUser, singlePass)
  }
  return map
}
const userMap = buildUserMap()
const authRequired = userMap.size > 0

// Session storage (in-memory, simple)
const activeSessions = new Set<string>()

app.use(cors({ credentials: true, origin: true }))
app.use(express.json({ limit: '50mb' }))
app.use(cookieParser())

// Auth routes (no auth required for these)
app.get('/api/auth/check', (_req, res) => {
  res.json({ authRequired })
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body
  
  if (!authRequired) {
    return res.json({ success: true })
  }
  
  if (userMap.get(username) === password) {
    const sessionId = `session-${Date.now()}-${Math.random()}`
    activeSessions.add(sessionId)
    res.cookie('sessionId', sessionId, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }) // 24h
    res.json({ success: true })
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' })
  }
})

// Auth middleware for protected routes
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!authRequired) {
    return next()
  }
  
  const sessionId = req.cookies?.sessionId
  if (sessionId && activeSessions.has(sessionId)) {
    return next()
  }
  
  res.status(401).json({ error: 'Unauthorized' })
}

// Apply auth only to /api/* routes (except /api/auth/*)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    return next()
  }
  if (req.path.startsWith('/api/auth/')) {
    return next()
  }
  requireAuth(req, res, next)
})

// Temp upload dir
const upload = multer({ dest: os.tmpdir() })

// SSE clients map: jobId → response
const sseClients = new Map<string, express.Response>()

// ─── Settings ──────────────────────────────────────────────────────────────
app.get('/api/settings', (_req, res) => {
  res.json(getSettings())
})

app.post('/api/settings', (req, res) => {
  saveSettings(req.body)
  res.json({ ok: true })
})

// ─── SSE progress stream ────────────────────────────────────────────────────
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  sseClients.set(jobId, res)
  req.on('close', () => sseClients.delete(jobId))
})

function sendProgress(jobId: string, type: string, data: object) {
  const client = sseClients.get(jobId)
  if (client) client.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
}

// ─── OCR ────────────────────────────────────────────────────────────────────
app.post('/api/ocr', upload.single('file'), async (req, res) => {
  const jobId = req.body.jobId as string
  const file = req.file

  if (!file) return res.status(400).json({ error: 'No file uploaded' })

  const settings = getSettings()
  if (!settings.azureDocIntelEndpoint || !settings.azureDocIntelKey) {
    fs.unlinkSync(file.path)
    return res.status(400).json({ error: 'Azure Document Intelligence credentials not configured. Open Settings.' })
  }

  try {
    // Keep a copy of the original PDF
    const originalPdfPath = path.join(os.tmpdir(), `${jobId}_original.pdf`)
    fs.copyFileSync(file.path, originalPdfPath)
    
    // Single call: OCR + font styles + searchable PDF
    const result = await runOCR(file.path, settings.azureDocIntelEndpoint, settings.azureDocIntelKey, (cur, tot) => {
      sendProgress(jobId, 'ocr-progress', { current: cur, total: tot })
    })
    
    fs.unlinkSync(file.path)
    res.json({ ...result, originalPdfPath })
  } catch (e: any) {
    console.error('OCR error:', e.message, e.stack)
    try { fs.unlinkSync(file.path) } catch {}
    res.status(500).json({ error: e.message })
  }
})

// ─── Translation ─────────────────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  const { paragraphs, targetLanguage, jobId } = req.body
  const settings = getSettings()

  if (!settings.azureTranslatorKey) {
    return res.status(400).json({ error: 'Azure Translator credentials not configured. Open Settings.' })
  }

  // Filter out empty/null texts before sending to Azure
  const validParagraphs = (paragraphs as Array<{ id: string; text: string }>)
    .filter(p => p && typeof p.text === 'string' && p.text.trim().length > 0)

  if (validParagraphs.length === 0) {
    return res.status(400).json({ error: 'No valid text paragraphs to translate.' })
  }

  try {
    const result = await translateParagraphs(
      validParagraphs, targetLanguage,
      settings.azureTranslatorKey, settings.azureTranslatorRegion,
      (cur, tot) => sendProgress(jobId, 'translate-progress', { current: cur, total: tot })
    )
    res.json(result)
  } catch (e: any) {
    console.error('Translation error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── Languages ───────────────────────────────────────────────────────────────
app.get('/api/languages', async (_req, res) => {
  const settings = getSettings()
  if (!settings.azureTranslatorKey) return res.json([])
  try {
    const langs = await getSupportedLanguages(settings.azureTranslatorKey, settings.azureTranslatorRegion)
    res.json(langs)
  } catch {
    res.json([])
  }
})

// ─── Export PDF ───────────────────────────────────────────────────────────────
app.post('/api/export/pdf', async (req, res) => {
  const { searchablePdfPath, paragraphs, title, preserveLayout, pageCount, originalPdfPath } = req.body

  console.log(`\n📤 Export PDF request:`)
  console.log(`   searchablePdfPath: ${searchablePdfPath} (exists: ${searchablePdfPath ? fs.existsSync(searchablePdfPath) : false})`)
  console.log(`   originalPdfPath:   ${originalPdfPath} (exists: ${originalPdfPath ? fs.existsSync(originalPdfPath) : false})`)
  console.log(`   paragraphs: ${paragraphs?.length ?? 0} items`)
  if (paragraphs?.length > 0) {
    const sample = paragraphs[0]
    console.log(`   sample[0]: text="${(sample.text || '').slice(0, 60)}", lines=${sample.lines?.length ?? 0}, bbox=${JSON.stringify(sample.boundingBox?.slice(0,4))}`)
  }

  const safeTitle = (title as string).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80)
  const outPath = path.join(os.tmpdir(), `${safeTitle}-translated-${Date.now()}.pdf`)

  // Determine best source PDF: prefer searchable (has Azure text layer), fall back to original
  const sourcePdf = searchablePdfPath && fs.existsSync(searchablePdfPath)
    ? searchablePdfPath
    : (originalPdfPath && fs.existsSync(originalPdfPath) ? originalPdfPath : null)

  // If we have a source PDF AND translated paragraphs → strip + re-place translated text
  if (sourcePdf && paragraphs && paragraphs.length > 0) {
    console.log(`✅ Using strip+placement method from: ${sourcePdf}`)
    try {
      await createTranslatedPDF(sourcePdf, paragraphs, outPath)
      res.download(outPath, `${title}.pdf`, () => {
        try { fs.unlinkSync(outPath) } catch {}
      })
      return
    } catch (e: any) {
      console.error('❌ createTranslatedPDF failed:', e.message, e.stack)
      // Fall through to text-only fallback
    }
  } else if (sourcePdf && (!paragraphs || paragraphs.length === 0)) {
    // OCR-only download: send source PDF directly
    console.log(`📄 Sending source PDF directly (no translations)`)
    res.download(sourcePdf, `${title}.pdf`, (err) => {
      if (err) console.error('Download error:', err)
    })
    return
  }

  // Last resort: generate a plain text-only PDF
  console.log('⚠️ Falling back to plain PDF generation')
  try {
    await exportToPDF(
      paragraphs || [],
      outPath,
      title,
      preserveLayout !== false,
      pageCount || 1,
      originalPdfPath && fs.existsSync(originalPdfPath) ? originalPdfPath : undefined
    )
    res.download(outPath, `${title}.pdf`, () => { try { fs.unlinkSync(outPath) } catch {} })
  } catch (e: any) {
    console.error('PDF export error:', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// ─── Export Word ──────────────────────────────────────────────────────────────
app.post('/api/export/word', async (req, res) => {
  const { paragraphs, title } = req.body
  const safeTitle = (title as string).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80)
  const outPath = path.join(os.tmpdir(), `${safeTitle}-${Date.now()}.docx`)
  try {
    await exportToWord(paragraphs, outPath, title)
    res.download(outPath, `${title}.docx`, () => { try { fs.unlinkSync(outPath) } catch {} })
  } catch (e: any) {
    console.error('Word export error:', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// ─── Export JSON ──────────────────────────────────────────────────────────────
app.post('/api/export/json', (req, res) => {
  const { data, title } = req.body
  const safeTitle = (title as string).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80)
  const outPath = path.join(os.tmpdir(), `${safeTitle}-${Date.now()}.json`)
  try {
    exportToJSON(data, outPath)
    res.download(outPath, `${title}.json`, () => { try { fs.unlinkSync(outPath) } catch {} })
  } catch (e: any) {
    console.error('JSON export error:', e.message, e.stack)
    res.status(500).json({ error: e.message })
  }
})

// ─── Serve PDF file for preview ──────────────────────────────────────────────
app.post('/api/file-preview', upload.single('file'), (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'No file' })
  const data = fs.readFileSync(file.path)
  fs.unlinkSync(file.path)
  res.setHeader('Content-Type', 'application/pdf')
  res.send(data)
})

// ─── Serve React frontend (production build) ───────────────────────────────
const distPath = path.join(__dirname, '../dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`)
  if (authRequired) {
    console.log(`🔒 Authentication enabled - Users: ${[...userMap.keys()].join(', ')}`)
  } else {
    console.log(`🔓 No authentication required (set AUTH_USERNAME and AUTH_PASSWORD to enable)`)
  }
})
