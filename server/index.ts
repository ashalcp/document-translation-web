import express from 'express'
import cors from 'cors'
import multer from 'multer'
import basicAuth from 'express-basic-auth'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { getSettings, saveSettings } from './settings'
import { runOCR, getSearchablePDF } from './ocr-service'
import { translateParagraphs, getSupportedLanguages } from './translator-service'
import { exportToPDF, exportToWord, exportToJSON } from './exporter'

const app = express()
const PORT = process.env.PORT || 3001

// Basic Auth (optional via env vars)
const AUTH_USER = process.env.AUTH_USERNAME
const AUTH_PASS = process.env.AUTH_PASSWORD

if (AUTH_USER && AUTH_PASS) {
  app.use(basicAuth({
    users: { [AUTH_USER]: AUTH_PASS },
    challenge: true,
    realm: 'Document Translation'
  }))
  console.log(`🔒 Basic auth enabled for user: ${AUTH_USER}`)
}

app.use(cors())
app.use(express.json({ limit: '50mb' }))

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
    
    // Get OCR results
    const result = await runOCR(file.path, settings.azureDocIntelEndpoint, settings.azureDocIntelKey, (cur, tot) => {
      sendProgress(jobId, 'ocr-progress', { current: cur, total: tot })
    })
    
    // Get Azure's searchable PDF with embedded OCR text
    const searchablePdfPath = path.join(os.tmpdir(), `${jobId}_searchable.pdf`)
    try {
      await getSearchablePDF(file.path, settings.azureDocIntelEndpoint, settings.azureDocIntelKey, searchablePdfPath)
      result.searchablePdfPath = searchablePdfPath
    } catch (pdfErr) {
      console.warn('Could not generate searchable PDF:', pdfErr)
      // Continue anyway - we have the OCR results
    }
    
    fs.unlinkSync(file.path)
    res.json({ ...result, pdfPath: originalPdfPath })
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
  const { paragraphs, title, preserveLayout, pageCount, searchablePdfPath, originalPdfPath } = req.body
  const safeTitle = (title as string).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80)
  const outPath = path.join(os.tmpdir(), `${safeTitle}-${Date.now()}.pdf`)
  try {
    await exportToPDF(
      paragraphs,
      outPath,
      title,
      preserveLayout || false,
      pageCount || 1,
      searchablePdfPath && fs.existsSync(searchablePdfPath) ? searchablePdfPath : undefined,
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
})
