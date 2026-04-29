import { PDFDocument, rgb, StandardFonts, PDFRawStream, PDFName, PDFArray } from 'pdf-lib'
import * as fontkit from '@pdf-lib/fontkit'
import { Document, Packer, Paragraph as DocxParagraph, TextRun, AlignmentType } from 'docx'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

// Use @napi-rs/canvas — ships pre-built binaries for Linux/macOS/Windows, no compilation needed.
// Falls back gracefully if somehow unavailable.
let napiCreateCanvas: any = null
let napiGlobalFonts: any = null
try {
  const napiCanvas = require('@napi-rs/canvas')
  napiCreateCanvas = napiCanvas.createCanvas
  napiGlobalFonts = napiCanvas.GlobalFonts
  console.log('✓ @napi-rs/canvas loaded — perfect Indic script rendering enabled')
} catch (e) {
  console.warn('⚠ @napi-rs/canvas not available — complex scripts will use pdf-lib fallback')
}

// Fonts will be copied to dist-server/fonts/ during build
const FONT_REGULAR = path.join(__dirname, 'fonts/NotoSans-Regular.ttf')
const FONT_BOLD = path.join(__dirname, 'fonts/NotoSans-Bold.ttf')

// Script-specific fonts (static non-variable TTFs, compatible with fontkit)
const SCRIPT_FONTS: Record<string, string> = {
  malayalam:  path.join(__dirname, 'fonts/NotoSansMalayalam.ttf'),
  devanagari: path.join(__dirname, 'fonts/NotoSansDevanagari.ttf'),
  bengali:    path.join(__dirname, 'fonts/NotoSansBengali.ttf'),
  arabic:     path.join(__dirname, 'fonts/NotoSansArabic.ttf'),
  tamil:      path.join(__dirname, 'fonts/NotoSansTamil.ttf'),
  telugu:     path.join(__dirname, 'fonts/NotoSansTelugu.ttf'),
  kannada:    path.join(__dirname, 'fonts/NotoSansKannada.ttf'),
  gujarati:   path.join(__dirname, 'fonts/NotoSansGujarati.ttf'),
  gurmukhi:   path.join(__dirname, 'fonts/NotoSansGurmukhi.ttf'),
  thai:       path.join(__dirname, 'fonts/NotoSansThai.ttf'),
  hebrew:     path.join(__dirname, 'fonts/NotoSansHebrew.ttf'),
  georgian:   path.join(__dirname, 'fonts/NotoSansGeorgian.ttf'),
  armenian:   path.join(__dirname, 'fonts/NotoSansArmenian.ttf'),
  myanmar:    path.join(__dirname, 'fonts/NotoSansMyanmar.ttf'),
  khmer:      path.join(__dirname, 'fonts/NotoSansKhmer.ttf'),
  ethiopic:   path.join(__dirname, 'fonts/NotoSansEthiopic.ttf'),
  sinhala:    path.join(__dirname, 'fonts/NotoSansSinhala.ttf'),
  oriya:      path.join(__dirname, 'fonts/NotoSansOriya.ttf'),
  lao:        path.join(__dirname, 'fonts/NotoSansLao.ttf'),
  meetei:     path.join(__dirname, 'fonts/NotoSansMeeteiMayek.ttf'),
  thaana:     path.join(__dirname, 'fonts/NotoSansThaana.ttf'),
}

function detectScript(text: string): string {
  if (/[\u0D00-\u0D7F]/.test(text)) return 'malayalam'
  if (/[\u0900-\u097F]/.test(text)) return 'devanagari'
  if (/[\u0980-\u09FF]/.test(text)) return 'bengali'
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) return 'arabic'
  if (/[\u0B80-\u0BFF]/.test(text)) return 'tamil'
  if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu'
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kannada'
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gujarati'
  if (/[\u0A00-\u0A7F]/.test(text)) return 'gurmukhi'
  if (/[\u0E00-\u0E7F]/.test(text)) return 'thai'
  if (/[\u0590-\u05FF\uFB1D-\uFB4F]/.test(text)) return 'hebrew'
  if (/[\u10A0-\u10FF]/.test(text)) return 'georgian'
  if (/[\u0530-\u058F]/.test(text)) return 'armenian'
  if (/[\u1000-\u109F]/.test(text)) return 'myanmar'
  if (/[\u1780-\u17FF]/.test(text)) return 'khmer'
  if (/[\u1200-\u137F]/.test(text)) return 'ethiopic'
  if (/[\u0D80-\u0DFF]/.test(text)) return 'sinhala'
  if (/[\u0B00-\u0B7F]/.test(text)) return 'oriya'
  if (/[\u0E80-\u0EFF]/.test(text)) return 'lao'
  if (/[\uABC0-\uABFF]/.test(text)) return 'meetei'
  if (/[\u0780-\u07BF]/.test(text)) return 'thaana'
  return 'latin'
}

export interface ExportLine {
  boundingBox: number[]
  text: string
  fontSize: number
  fontWeight?: string
  color?: string
}

export interface ExportParagraph {
  text: string
  pageNumber?: number
  boundingBox?: number[]
  fontSize?: number
  fontWeight?: string
  fontStyle?: string
  color?: string
  backgroundColor?: string
  fontFamily?: string
  lines?: ExportLine[]
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || typeof hex !== 'string') return null
  const clean = hex.replace('#', '').trim()
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  if (full.length !== 6) return null
  const m = full.match(/.{2}/g)
  if (!m) return null
  const r = parseInt(m[0], 16), g = parseInt(m[1], 16), b = parseInt(m[2], 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null
  return { r: r / 255, g: g / 255, b: b / 255 }
}

// Complex/Indic scripts
const COMPLEX_SCRIPTS = new Set([
  'malayalam','devanagari','bengali','tamil','telugu','kannada',
  'gujarati','gurmukhi','oriya','sinhala','myanmar','khmer',
  'thai','lao','tibetan','meetei','thaana','ethiopic',
])

// Track which fonts have been registered with @napi-rs/canvas
const canvasFontsRegistered = new Set<string>()

/**
 * Render text to a PNG buffer using @napi-rs/canvas.
 * Ships pre-built binaries for Linux/macOS — works on Azure without libcairo.
 * Auto-shrinks font until all text fits inside slotW x slotH.
 */
function renderTextToImage(
  text: string,
  fontFamily: string,
  fontPath: string,
  fontSize: number,
  slotW: number,
  slotH: number,
  colorR: number,
  colorG: number,
  colorB: number
): Buffer | null {
  if (!napiCreateCanvas || !napiGlobalFonts) return null

  // Register the font once with GlobalFonts
  if (!canvasFontsRegistered.has(fontFamily)) {
    try {
      napiGlobalFonts.registerFromPath(fontPath, fontFamily)
      canvasFontsRegistered.add(fontFamily)
    } catch (e) {
      console.warn(`canvas registerFont failed for ${fontFamily}:`, e)
      return null
    }
  }

  const scale = 2 // Render at 2x for crispness
  const w = Math.max(1, Math.ceil(slotW * scale))
  const h = Math.max(1, Math.ceil(slotH * scale))
  const padX = 2 * scale
  const padTop = Math.ceil(0.20 * fontSize * scale)  // room for ascenders
  const padBottom = Math.ceil(0.15 * fontSize * scale) // room for descenders
  const availW = w - padX * 2
  const availH = h - padTop - padBottom

  // Measurement canvas (no drawing — just measure)
  const measureCanvas = napiCreateCanvas(w, h)
  const mCtx = measureCanvas.getContext('2d')
  const words = text.split(/\s+/).filter(Boolean)

  // Helper: word-wrap at a given font size, return lines and total height
  function wrapText(fs: number): { lines: string[]; totalH: number } {
    mCtx.font = `${fs}px "${fontFamily}"`
    const lineH = fs * 1.3
    const lines: string[] = []
    let cur = ''
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word
      if (cur && mCtx.measureText(test).width > availW) {
        lines.push(cur); cur = word
      } else {
        cur = test
      }
    }
    if (cur) lines.push(cur)
    return { lines, totalH: lines.length * lineH }
  }

  // Auto-shrink: reduce by 8% each step until fits
  let fs = fontSize * scale
  let wrapped = wrapText(fs)
  while ((wrapped.totalH > availH || wrapped.lines.some((l: string) => {
    mCtx.font = `${fs}px "${fontFamily}"`
    return mCtx.measureText(l).width > availW
  })) && fs > 4 * scale) {
    fs = Math.max(4 * scale, fs * 0.92)
    wrapped = wrapText(fs)
  }

  // Draw onto actual canvas
  const canvas = napiCreateCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  ctx.font = `${fs}px "${fontFamily}"`
  ctx.fillStyle = `rgb(${Math.round(colorR * 255)},${Math.round(colorG * 255)},${Math.round(colorB * 255)})`
  ctx.textBaseline = 'alphabetic'

  const lineH = fs * 1.3
  wrapped.lines.forEach((line: string, i: number) => {
    const y = padTop + Math.ceil(fs * 0.82) + i * lineH
    ctx.fillText(line, padX, y)
  })

  return canvas.toBuffer('image/png')
}

function drawLineInSlot(
  page: any, words: string[], startIdx: number,
  font: any, fontSize: number, lineBox: number[],
  pageHeight: number, textColor: any,
  complexScript: boolean = false
): number {
  const [x1, y1, x2, , , y3] = lineBox
  const slotX = x1 * 72, slotY = pageHeight - (y1 * 72)
  const slotW = (x2 - x1) * 72, slotH = (y3 - y1) * 72
  const availW = slotW - 2

  // Build line — first word always included, add more while they fit
  let line = '', wordCount = 0
  for (let i = startIdx; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]
    if (font.widthOfTextAtSize(test, fontSize) > availW && line) break
    line = test; wordCount++
  }
  if (!line) return 0

  // Shrink font if the built line is still wider than the slot
  const lineW = font.widthOfTextAtSize(line, fontSize)
  if (lineW > availW && availW > 0) {
    fontSize = Math.max(5, fontSize * availW / lineW)
  }

  const descenderGap = Math.max(2, slotH * 0.15)
  const textY = slotY - slotH + descenderGap

  if (complexScript && wordCount > 1) {
    // Draw each word separately so the PDF viewer applies GPOS on each word
    // independently. Multi-word single-run shaping can cause mark-to-base
    // GPOS lookups to mis-attach vowel signs across word boundaries → overlap.
    const spaceW = font.widthOfTextAtSize(' ', fontSize)
    let curX = slotX + 1
    for (let i = startIdx; i < startIdx + wordCount; i++) {
      try { page.drawText(words[i], { x: curX, y: textY, font, size: fontSize, color: textColor }) }
      catch { /* skip */ }
      curX += font.widthOfTextAtSize(words[i], fontSize) + spaceW
    }
  } else {
    try { page.drawText(line, { x: slotX + 1, y: textY, font, size: fontSize, color: textColor }) }
    catch { /* skip unencodable glyphs */ }
  }
  return wordCount
}

/**
 * Strip all text from PDF, then place translated words into original line slots.
 * Exact same algorithm as the Electron app's createTranslatedPDF.
 */
export async function createTranslatedPDF(
  searchablePdfPath: string,
  paragraphs: ExportParagraph[],
  outputPath: string
): Promise<void> {
  console.log(`\n📄 Creating translated PDF (strip + line-accurate placement)`)
  console.log(`   Paragraphs: ${paragraphs.length}`)

  // Step 1: Strip all original text
  const inputBytes = fs.readFileSync(searchablePdfPath)
  const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true })

  let stripped = 0
  for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const filterEntry = obj.dict.get(PDFName.of('Filter'))
    const isFlate = (filterEntry instanceof PDFName && filterEntry.asString() === '/FlateDecode') ||
      (filterEntry instanceof PDFArray && (() => {
        for (let i = 0; i < filterEntry.size(); i++) {
          const f = filterEntry.get(i)
          if (f instanceof PDFName && f.asString() === '/FlateDecode') return true
        }
        return false
      })())
    const rawBytes = obj.contents
    let text: string
    try {
      text = isFlate ? zlib.inflateSync(Buffer.from(rawBytes)).toString('latin1') : Buffer.from(rawBytes).toString('latin1')
    } catch { continue }
    if (!text.includes('BT') || !text.includes('ET')) continue
    const strippedText = text.replace(/BT[\s\S]*?ET/g, '')
    if (strippedText === text) continue
    const strippedBuf = Buffer.from(strippedText, 'latin1')
    const newBytes = isFlate ? new Uint8Array(zlib.deflateSync(strippedBuf)) : new Uint8Array(strippedBuf)
    ;(obj as any).contents = newBytes
    obj.dict.set(PDFName.of('Length'), pdfDoc.context.obj(newBytes.length))
    stripped++
  }
  console.log(`✓ Stripped ${stripped} text streams`)

  // Step 2: Embed fonts
  pdfDoc.registerFontkit(fontkit as any)
  let fontRegular: any, fontBold: any
  try {
    fontRegular = await pdfDoc.embedFont(fs.readFileSync(FONT_REGULAR), { subset: false })
    fontBold    = await pdfDoc.embedFont(fs.readFileSync(FONT_BOLD),    { subset: false })
    console.log('✓ NotoSans fonts loaded')
  } catch {
    fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
    fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    console.warn('⚠ Fallback to Helvetica')
  }

  // Detect which script the translated content uses and embed only that font
  const allText = paragraphs.map(p => p.text || '').join(' ')
  const detectedScript = detectScript(allText)
  let scriptFont: any = null
  if (detectedScript !== 'latin') {
    const fontPath = SCRIPT_FONTS[detectedScript]
    if (fontPath && fs.existsSync(fontPath)) {
      try {
        scriptFont = await pdfDoc.embedFont(fs.readFileSync(fontPath), { subset: false })
        console.log(`✓ Script font loaded: ${detectedScript}`)
      } catch (e: any) {
        console.warn(`⚠ Failed to load ${detectedScript} font: ${e?.message}`)
      }
    } else {
      console.warn(`⚠ No font file for script: ${detectedScript}`)
    }
  }

  const getFont = (bold: boolean): any => {
    if (scriptFont && detectedScript !== 'latin') return scriptFont
    return bold ? fontBold : fontRegular
  }
  const isComplex = COMPLEX_SCRIPTS.has(detectedScript)
  const complexFontPath = isComplex ? (SCRIPT_FONTS[detectedScript] ?? null) : null
  const complexFontFamily = isComplex ? `NotoSans_${detectedScript}` : null

  // Helper: embed a slot as a canvas-rendered image (for complex scripts)
  async function drawComplexSlot(
    page: any, text: string, slotX: number, slotY: number,
    slotW: number, slotH: number,
    fontSize: number, colorR: number, colorG: number, colorB: number
  ) {
    if (!complexFontPath || !complexFontFamily || slotW <= 0 || slotH <= 0) return
    try {
      const pngBuf = renderTextToImage(
        text, complexFontFamily, complexFontPath,
        fontSize, slotW, slotH, colorR, colorG, colorB
      )
      if (!pngBuf) return
      const img = await pdfDoc.embedPng(pngBuf)
      page.drawImage(img, { x: slotX, y: slotY, width: slotW, height: slotH })
    } catch (e) {
      console.warn('canvas image embed failed:', e)
    }
  }

  // Step 3: Group by page, place translated words into line slots
  const pageMap = new Map<number, ExportParagraph[]>()
  for (const p of paragraphs) {
    const n = p.pageNumber || 1
    if (!pageMap.has(n)) pageMap.set(n, [])
    pageMap.get(n)!.push(p)
  }

  const totalPages = pdfDoc.getPageCount()
  for (const [pageNum, paras] of pageMap.entries()) {
    if (pageNum - 1 >= totalPages) continue
    const page = pdfDoc.getPage(pageNum - 1)
    const { height: pageHeight } = page.getSize()
    let placed = 0, skipped = 0

    for (const p of paras) {
      if (!p.text?.trim()) { skipped++; continue }

      // Case A: line-accurate placement
      if (p.lines && p.lines.length > 0) {
        const words = p.text.split(/\s+/).filter(Boolean)
        let wordIdx = 0
        for (const line of p.lines) {
          if (wordIdx >= words.length) break
          if (!line.boundingBox || line.boundingBox.length < 8) continue
          const [x1, y1, x2, , , y3] = line.boundingBox
          const slotX = x1 * 72, slotY = pageHeight - (y3 * 72)
          const slotW = (x2 - x1) * 72, slotH = (y3 - y1) * 72
          const fs_size = Math.max(5, line.fontSize)
          const tc = line.color ? hexToRgb(line.color) : null
          const { r, g, b } = tc ?? { r: 0.08, g: 0.08, b: 0.08 }

          if (isComplex) {
            // For complex scripts (Malayalam etc.) avoid ANY fontkit/GPOS calls —
            // font.widthOfTextAtSize() triggers the GPOS processor which crashes.
            // Use a character-count estimate (em-width ~0.55× fontSize) instead.
            const estimatedCharW = fs_size * 0.55
            const availW = slotW - 2
            let slotText = '', count = 0
            for (let i = wordIdx; i < words.length; i++) {
              const test = slotText ? `${slotText} ${words[i]}` : words[i]
              if (test.length * estimatedCharW > availW && slotText) break
              slotText = test; count++
            }
            if (!slotText) { slotText = words[wordIdx] ?? ''; count = 1 }
            await drawComplexSlot(page, slotText, slotX, slotY, slotW, slotH, fs_size, r, g, b)
            wordIdx += count
          } else {
            const font = getFont(line.fontWeight === 'bold')
            const consumed = drawLineInSlot(page, words, wordIdx, font, fs_size, line.boundingBox, pageHeight, rgb(r, g, b), false)
            wordIdx += Math.max(1, consumed)
          }
        }
        placed++; continue
      }

      // Case B: paragraph bbox fallback
      if (!p.boundingBox || p.boundingBox.length < 8) { skipped++; continue }
      const [x1, y1, x2, , , y3] = p.boundingBox
      const pdfX = x1 * 72, pdfY = pageHeight - (y3 * 72)
      const boxW = (x2 - x1) * 72, boxH = (y3 - y1) * 72
      if (boxW <= 0 || boxH <= 0) { skipped++; continue }
      const fontSize = Math.max(5, p.fontSize ?? boxH * 0.72)
      const tc = p.color ? hexToRgb(p.color) : null
      const { r, g, b } = tc ?? { r: 0.08, g: 0.08, b: 0.08 }

      if (isComplex) {
        await drawComplexSlot(page, p.text, pdfX, pdfY, boxW, boxH, fontSize, r, g, b)
      } else {
        const font = getFont(p.fontWeight === 'bold')
        let fs_size = Math.max(5, fontSize)
        const availW = boxW - 4
        const w = font.widthOfTextAtSize(p.text, fs_size)
        if (w > availW && availW > 0) fs_size = Math.max(5, fs_size * availW / w)
        const lineH = fs_size * 1.35
        const maxLines = Math.max(1, Math.floor(boxH / lineH))
        const words = p.text.split(/\s+/).filter(Boolean)
        const wrappedLines: string[] = []
        let cur = ''
        for (const word of words) {
          const test = cur ? `${cur} ${word}` : word
          if (font.widthOfTextAtSize(test, fs_size) > availW && cur) {
            wrappedLines.push(cur); cur = word
            if (wrappedLines.length >= maxLines) break
          } else { cur = test }
        }
        if (cur && wrappedLines.length < maxLines) wrappedLines.push(cur)
        wrappedLines.forEach((lt, li) => {
          const lineY = (pdfY + boxH - fs_size) - (li * lineH)
          if (lineY < pdfY - 2) return
          try { page.drawText(lt, { x: pdfX + 2, y: lineY, font: font, size: fs_size, color: rgb(r, g, b) }) }
          catch { /* skip */ }
        })
      }
      placed++
    }
    console.log(`  Page ${pageNum}: placed ${placed}, skipped ${skipped}`)
  }

  const bytes = await pdfDoc.save({ useObjectStreams: false })
  fs.writeFileSync(outputPath, bytes)
  console.log('✓ Translated PDF saved')
}

export async function exportToPDF(
  paragraphs: Array<{ text: string; boundingBox?: number[]; pageNumber?: number }>,
  outputPath: string,
  title: string,
  preserveLayout: boolean = false,
  totalPages: number = 1,
  originalPdfPath?: string
): Promise<void> {
  const doc = await PDFDocument.create()
  
  let fontRegular: any
  let fontBold: any

  // Try to load Unicode fonts, fall back to standard fonts if they fail
  try {
    if (fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD)) {
      doc.registerFontkit(fontkit as any)
      const fontRegularBytes = fs.readFileSync(FONT_REGULAR)
      const fontBoldBytes = fs.readFileSync(FONT_BOLD)
      fontRegular = await doc.embedFont(fontRegularBytes, { subset: false })
      fontBold = await doc.embedFont(fontBoldBytes, { subset: false })
      console.log('Successfully loaded Unicode fonts without subsetting')
    } else {
      throw new Error('Font files not found')
    }
  } catch (err) {
    console.warn('Failed to load Unicode fonts, using standard fonts:', err)
    fontRegular = await doc.embedFont(StandardFonts.Helvetica)
    fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  }

  const fontSize = 11
  const margin = 50
  const lineHeight = fontSize * 1.5

  let page = doc.addPage()
  let { width, height } = page.getSize()
  let y = height - margin

  const drawText = (text: string, font: any, size: number) => {
    if (!text || !text.trim()) return
    const words = text.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      const testWidth = font.widthOfTextAtSize(test, size)
      if (testWidth > width - margin * 2 && line) {
        if (y < margin + lineHeight) {
          page = doc.addPage()
          y = page.getSize().height - margin
        }
        page.drawText(line, { x: margin, y, font, size, color: rgb(0, 0, 0) })
        y -= lineHeight
        line = word
      } else {
        line = test
      }
    }
    if (line) {
      if (y < margin + lineHeight) {
        page = doc.addPage()
        y = page.getSize().height - margin
      }
      page.drawText(line, { x: margin, y, font, size, color: rgb(0, 0, 0) })
      y -= lineHeight
    }
    y -= lineHeight * 0.5
  }

  // Title
  drawText(title, fontBold, 16)
  y -= lineHeight

  // Paragraphs
  for (const para of paragraphs) {
    drawText(para.text, fontRegular, fontSize)
  }

  // Save with compatibility options
  const pdfBytes = await doc.save({
    useObjectStreams: false,  // Better compatibility with older PDF readers
    addDefaultPage: false,
    objectsPerTick: 50
  })
  fs.writeFileSync(outputPath, pdfBytes, { encoding: 'binary' })
}

export async function exportToWord(
  paragraphs: Array<{ text: string }>,
  outputPath: string,
  title: string
): Promise<void> {
  const doc = new Document({
    sections: [{
      children: [
        new DocxParagraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: title, bold: true, size: 32 })]
        }),
        new DocxParagraph({ children: [] }),
        ...paragraphs
          .filter(p => p.text && p.text.trim())
          .map(p => new DocxParagraph({
            children: [new TextRun({ text: p.text, size: 22 })]
          }))
      ]
    }]
  })
  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(outputPath, buffer)
}

export function exportToJSON(
  data: any,
  outputPath: string
): void {
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
}
