import { PDFDocument, rgb, StandardFonts, PDFRawStream, PDFName, PDFArray } from 'pdf-lib'
import * as fontkit from '@pdf-lib/fontkit'
import { Document, Packer, Paragraph as DocxParagraph, TextRun, AlignmentType } from 'docx'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

// Fonts will be copied to dist-server/fonts/ during build
const FONT_REGULAR      = path.join(__dirname, 'fonts/NotoSans-Regular.ttf')
const FONT_BOLD         = path.join(__dirname, 'fonts/NotoSans-Bold.ttf')
const FONT_MALAYALAM    = path.join(__dirname, 'fonts/NotoSansMalayalam.ttf')
const FONT_ARABIC       = path.join(__dirname, 'fonts/NotoSansArabic.ttf')
const FONT_TAMIL        = path.join(__dirname, 'fonts/NotoSansTamil.ttf')
const FONT_DEVANAGARI   = path.join(__dirname, 'fonts/NotoSansDevanagari.ttf')
const FONT_BENGALI      = path.join(__dirname, 'fonts/NotoSansBengali.ttf')
const FONT_GUJARATI     = path.join(__dirname, 'fonts/NotoSansGujarati.ttf')
const FONT_GURMUKHI     = path.join(__dirname, 'fonts/NotoSansGurmukhi.ttf')
const FONT_TELUGU       = path.join(__dirname, 'fonts/NotoSansTelugu.ttf')
const FONT_KANNADA      = path.join(__dirname, 'fonts/NotoSansKannada.ttf')
const FONT_SINHALA      = path.join(__dirname, 'fonts/NotoSansSinhala.ttf')
const FONT_THAI         = path.join(__dirname, 'fonts/NotoSansThai.ttf')
const FONT_HEBREW       = path.join(__dirname, 'fonts/NotoSansHebrew.ttf')
const FONT_GEORGIAN     = path.join(__dirname, 'fonts/NotoSansGeorgian.ttf')
const FONT_ARMENIAN     = path.join(__dirname, 'fonts/NotoSansArmenian.ttf')
const FONT_KHMER        = path.join(__dirname, 'fonts/NotoSansKhmer.ttf')
const FONT_MYANMAR      = path.join(__dirname, 'fonts/NotoSansMyanmar.ttf')
const FONT_LAO          = path.join(__dirname, 'fonts/NotoSansLao.ttf')
const FONT_ETHIOPIC     = path.join(__dirname, 'fonts/NotoSansEthiopic.ttf')
const FONT_ORIYA        = path.join(__dirname, 'fonts/NotoSansOriya.ttf')
const FONT_MEETEI       = path.join(__dirname, 'fonts/NotoSansMeeteiMayek.ttf')
const FONT_THAANA       = path.join(__dirname, 'fonts/NotoSansThaana.ttf')
const FONT_CJK_SC       = path.join(__dirname, 'fonts/NotoSansSC.ttf')   // Chinese Simplified + Traditional
const FONT_JP           = path.join(__dirname, 'fonts/NotoSansJP.ttf')   // Japanese
const FONT_KR           = path.join(__dirname, 'fonts/NotoSansKR.ttf')   // Korean

// Unicode range → font key
type ScriptKey =
  'malayalam'|'arabic'|'tamil'|'devanagari'|'bengali'|'gujarati'|'gurmukhi'|
  'telugu'|'kannada'|'sinhala'|'thai'|'hebrew'|'georgian'|'armenian'|'khmer'|
  'myanmar'|'lao'|'ethiopic'|'oriya'|'meetei'|'thaana'|'japanese'|'korean'|'cjk'|'latin'

function detectScript(text: string): ScriptKey {
  if (/[\u0D00-\u0D7F]/.test(text)) return 'malayalam'
  if (/[\u0900-\u097F\uA8E0-\uA8FF]/.test(text)) return 'devanagari'         // Hindi, Marathi, Nepali, Maithili, Bhojpuri, etc.
  if (/[\u0980-\u09FF]/.test(text)) return 'bengali'                          // Bangla, Assamese
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gujarati'
  if (/[\u0A00-\u0A7F]/.test(text)) return 'gurmukhi'                         // Punjabi
  if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu'
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kannada'
  if (/[\u0B80-\u0BFF]/.test(text)) return 'tamil'
  if (/[\u0B00-\u0B7F]/.test(text)) return 'oriya'
  if (/[\u0D80-\u0DFF]/.test(text)) return 'sinhala'
  if (/[\u0E00-\u0E7F]/.test(text)) return 'thai'
  if (/[\u0E80-\u0EFF]/.test(text)) return 'lao'
  if (/[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/.test(text)) return 'myanmar'
  if (/[\u1780-\u17FF\u19E0-\u19FF]/.test(text)) return 'khmer'
  if (/[\u0F00-\u0FFF]/.test(text)) return 'myanmar'                          // Tibetan — Myanmar font has partial coverage; use Myanmar font
  if (/[\u0590-\u05FF\uFB1D-\uFB4F]/.test(text)) return 'hebrew'
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) return 'arabic'  // Arabic, Persian, Urdu, Pashto, Dari, Sindhi, Uyghur, Kashmiri
  if (/[\u10A0-\u10FF\u2D00-\u2D2F]/.test(text)) return 'georgian'
  if (/[\u0530-\u058F\uFB13-\uFB17]/.test(text)) return 'armenian'
  if (/[\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF\uAB01-\uAB2F]/.test(text)) return 'ethiopic'  // Amharic, Tigrinya
  if (/[\uABC0-\uABFF]/.test(text)) return 'meetei'                           // Manipuri
  if (/[\u0780-\u07BF]/.test(text)) return 'thaana'                           // Divehi
  if (/[\u3040-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/.test(text)) return 'japanese'  // Hiragana, Katakana
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text)) return 'korean'
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{2A6DF}]/u.test(text)) return 'cjk'  // Chinese, Japanese kanji, etc.
  return 'latin'
}

const SCRIPT_FONT_FILES: Record<ScriptKey, string> = {
  malayalam:  FONT_MALAYALAM,
  arabic:     FONT_ARABIC,
  tamil:      FONT_TAMIL,
  devanagari: FONT_DEVANAGARI,
  bengali:    FONT_BENGALI,
  gujarati:   FONT_GUJARATI,
  gurmukhi:   FONT_GURMUKHI,
  telugu:     FONT_TELUGU,
  kannada:    FONT_KANNADA,
  sinhala:    FONT_SINHALA,
  thai:       FONT_THAI,
  hebrew:     FONT_HEBREW,
  georgian:   FONT_GEORGIAN,
  armenian:   FONT_ARMENIAN,
  khmer:      FONT_KHMER,
  myanmar:    FONT_MYANMAR,
  lao:        FONT_LAO,
  ethiopic:   FONT_ETHIOPIC,
  oriya:      FONT_ORIYA,
  meetei:     FONT_MEETEI,
  thaana:     FONT_THAANA,
  japanese:   FONT_JP,
  korean:     FONT_KR,
  cjk:        FONT_CJK_SC,
  latin:      FONT_REGULAR,
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

function drawLineInSlot(
  page: any, words: string[], startIdx: number,
  font: any, fontSize: number, lineBox: number[],
  pageHeight: number, textColor: any
): number {
  const [x1, y1, x2, , , y3] = lineBox
  const slotX = x1 * 72, slotY = pageHeight - (y1 * 72)
  const slotW = (x2 - x1) * 72, slotH = (y3 - y1) * 72
  const availW = slotW - 2

  // Don't clamp font size — allow large sizes for logos/headings
  // Only scale down if text is wider than the slot
  let line = '', wordCount = 0
  for (let i = startIdx; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]
    if (font.widthOfTextAtSize(test, fontSize) > availW && line) break
    line = test; wordCount++
  }
  if (!line && startIdx < words.length) {
    line = words[startIdx]; wordCount = 1
    const w = font.widthOfTextAtSize(line, fontSize)
    if (w > availW && availW > 0) fontSize = Math.max(5, fontSize * availW / w)
  }
  if (!line) return 0

  // Vertical: baseline = bottom of slot + descender gap (15% of slot height, min 2pt)
  // This works correctly for both small body text and large logo/heading text
  const descenderGap = Math.max(2, slotH * 0.15)
  const textY = slotY - slotH + descenderGap
  try { page.drawText(line, { x: slotX + 1, y: textY, font, size: fontSize, color: textColor }) }
  catch { /* skip unencodable glyphs */ }
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
  const scriptFonts: Partial<Record<ScriptKey, any>> = {}
  try {
    fontRegular = await pdfDoc.embedFont(fs.readFileSync(FONT_REGULAR), { subset: false })
    fontBold    = await pdfDoc.embedFont(fs.readFileSync(FONT_BOLD),    { subset: false })
    console.log('✓ NotoSans fonts loaded')
  } catch {
    fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
    fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    console.warn('⚠ Fallback to Helvetica')
  }
  // Embed all script-specific fonts
  for (const [script, fontPath] of Object.entries(SCRIPT_FONT_FILES) as [ScriptKey, string][]) {
    if (script === 'latin') continue
    if (fs.existsSync(fontPath)) {
      try {
        scriptFonts[script] = await pdfDoc.embedFont(fs.readFileSync(fontPath), { subset: false })
      } catch { console.warn(`⚠ Failed to load ${script} font`) }
    }
  }
  console.log(`✓ Script fonts loaded: ${Object.keys(scriptFonts).join(', ')}`)

  // Helper: pick font based on text content
  const getFont = (text: string, bold: boolean): any => {
    const script = detectScript(text)
    if (script !== 'latin' && scriptFonts[script]) return scriptFonts[script]
    return bold ? fontBold : fontRegular
  }

  // Step 3: Group by page, place translated words into line slots
  const pageMap = new Map<number, ExportParagraph[]>()
  for (const p of paragraphs) {
    const n = p.pageNumber || 1
    if (!pageMap.has(n)) pageMap.set(n, [])
    pageMap.get(n)!.push(p)
  }

  const totalPages = pdfDoc.getPageCount()
  pageMap.forEach((paras, pageNum) => {
    if (pageNum - 1 >= totalPages) return
    const page = pdfDoc.getPage(pageNum - 1)
    const { height } = page.getSize()
    let placed = 0, skipped = 0

    paras.forEach(p => {
      if (!p.text?.trim()) { skipped++; return }
      const words = p.text.split(/\s+/).filter(Boolean)
      if (words.length === 0) { skipped++; return }

      // Case A: line-accurate placement
      if (p.lines && p.lines.length > 0) {
        let wordIdx = 0
        for (const line of p.lines) {
          if (wordIdx >= words.length) break
          if (!line.boundingBox || line.boundingBox.length < 8) continue
          const lineText = words.slice(wordIdx).join(' ')
          const font = getFont(lineText, line.fontWeight === 'bold')
          const fs = Math.max(5, line.fontSize)  // no upper clamp — allow large logo/heading sizes
          const tc = line.color ? hexToRgb(line.color) : null
          const c = tc ?? { r: 0.08, g: 0.08, b: 0.08 }
          const textColor = rgb(c.r, c.g, c.b)
          const consumed = drawLineInSlot(page, words, wordIdx, font, fs, line.boundingBox, height, textColor)
          wordIdx += Math.max(1, consumed)
        }
        placed++; return
      }

      // Case B: paragraph bbox fallback
      if (!p.boundingBox || p.boundingBox.length < 8) { skipped++; return }
      const [x1, y1, x2, , , y3] = p.boundingBox
      const pdfX = x1 * 72, pdfY = height - (y1 * 72)
      const boxW = (x2 - x1) * 72, boxH = (y3 - y1) * 72
      if (boxW <= 0 || boxH <= 0) { skipped++; return }

      const font = getFont(p.text, p.fontWeight === 'bold')
      let fontSize = Math.max(5, p.fontSize ?? boxH * 0.72)  // no upper clamp
      const availW = boxW - 4
      const tc = p.color ? hexToRgb(p.color) : null
      const c = tc ?? { r: 0.08, g: 0.08, b: 0.08 }
      const textColor = rgb(c.r, c.g, c.b)

      const w = font.widthOfTextAtSize(p.text, fontSize)
      if (w > availW && availW > 0) fontSize = Math.max(5, fontSize * availW / w)
      const lineH = fontSize * 1.35
      const maxLines = Math.max(1, Math.floor(boxH / lineH))
      const wrappedLines: string[] = []
      let cur = ''
      for (const word of words) {
        const test = cur ? `${cur} ${word}` : word
        if (font.widthOfTextAtSize(test, fontSize) > availW && cur) {
          wrappedLines.push(cur); cur = word
          if (wrappedLines.length >= maxLines) break
        } else { cur = test }
      }
      if (cur && wrappedLines.length < maxLines) wrappedLines.push(cur)
      wrappedLines.forEach((lt, li) => {
        const lineY = (pdfY - fontSize) - (li * lineH)
        if (lineY < pdfY - boxH - 2) return
        try { page.drawText(lt, { x: pdfX + 2, y: lineY, font, size: fontSize, color: textColor }) }
        catch { /* skip */ }
      })
      placed++
    })
    console.log(`  Page ${pageNum}: placed ${placed}, skipped ${skipped}`)
  })

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
