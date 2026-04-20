import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { Document, Packer, Paragraph as DocxParagraph, TextRun } from 'docx'
import * as fs from 'fs'

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
  page.drawText(title, { x: margin, y, font: titleFont, size: 16, color: rgb(0, 0, 0) })
  y -= lineHeight * 2

  for (const para of paragraphs) {
    drawText(para.text)
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
        new DocxParagraph({ children: [new TextRun({ text: title, bold: true, size: 32 })] }),
        new DocxParagraph({ children: [] }),
        ...paragraphs.map(p => new DocxParagraph({ children: [new TextRun({ text: p.text, size: 22 })] }))
      ]
    }]
  })
  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(outputPath, buffer)
}
