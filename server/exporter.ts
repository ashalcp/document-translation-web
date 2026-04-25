import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { Document, Packer, Paragraph as DocxParagraph, TextRun, AlignmentType } from 'docx'
import * as fs from 'fs'
import * as path from 'path'

export async function exportToPDF(
  paragraphs: Array<{ text: string; boundingBox?: number[]; pageNumber?: number }>,
  outputPath: string,
  title: string,
  preserveLayout: boolean = false,
  totalPages: number = 1,
  originalPdfPath?: string
): Promise<void> {
  const doc = await PDFDocument.create()
  
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

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

export function exportToJSON(
  data: any,
  outputPath: string
): void {
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
}
