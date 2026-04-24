import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Document, Packer, Paragraph as DocxParagraph, TextRun, AlignmentType } from 'docx'
import * as fs from 'fs'

// Strips characters not supported by pdf-lib's standard fonts (latin-1 range only)
function toSafeLatinText(text: string): string {
  // Replace common Unicode punctuation with ASCII equivalents
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')
    // Replace any remaining non-latin-1 chars with '?'
    .replace(/[^\x00-\xFF]/g, '?')
}

export async function exportToPDF(
  paragraphs: Array<{ text: string }>,
  outputPath: string,
  title: string
): Promise<void> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontSize = 11
  const margin = 50
  const lineHeight = fontSize * 1.5

  let page = doc.addPage()
  let { width, height } = page.getSize()
  let y = height - margin

  const drawText = (text: string) => {
    if (!text || !text.trim()) return
    const words = text.split(' ')
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      const testWidth = font.widthOfTextAtSize(test, fontSize)
      if (testWidth > width - margin * 2 && line) {
        if (y < margin + lineHeight) {
          page = doc.addPage()
          y = page.getSize().height - margin
        }
        page.drawText(line, { x: margin, y, font, size: fontSize, color: rgb(0, 0, 0) })
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
      page.drawText(line, { x: margin, y, font, size: fontSize, color: rgb(0, 0, 0) })
      y -= lineHeight
    }
    y -= lineHeight * 0.5
  }

  const titleFont = await doc.embedFont(StandardFonts.HelveticaBold)
  page.drawText(toSafeLatinText(title), { x: margin, y, font: titleFont, size: 16, color: rgb(0, 0, 0) })
  y -= lineHeight * 2

  for (const para of paragraphs) {
    drawText(toSafeLatinText(para.text))
  }

  const pdfBytes = await doc.save()
  fs.writeFileSync(outputPath, pdfBytes)
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
