import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import * as fontkit from '@pdf-lib/fontkit'
import { Document, Packer, Paragraph as DocxParagraph, TextRun, AlignmentType } from 'docx'
import * as fs from 'fs'
import * as path from 'path'

const FONT_REGULAR = path.join(__dirname, 'fonts/NotoSans-Regular.ttf')
const FONT_BOLD = path.join(__dirname, 'fonts/NotoSans-Bold.ttf')

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
      fontRegular = await doc.embedFont(fontRegularBytes, { subset: true })
      fontBold = await doc.embedFont(fontBoldBytes, { subset: true })
      console.log('Successfully loaded Unicode fonts with subsetting')
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
