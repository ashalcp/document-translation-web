import { PDFDocument, rgb } from 'pdf-lib'
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
  let doc: PDFDocument
  
  // If we have the original PDF and want to preserve layout, load it and overlay translations
  if (preserveLayout && originalPdfPath && fs.existsSync(originalPdfPath)) {
    const originalBytes = fs.readFileSync(originalPdfPath)
    doc = await PDFDocument.load(originalBytes)
    doc.registerFontkit(fontkit as any)
    
    const fontRegularBytes = fs.readFileSync(FONT_REGULAR)
    const fontRegular = await doc.embedFont(fontRegularBytes)

    // Group paragraphs by page
    const pageMap = new Map<number, typeof paragraphs>()
    paragraphs.forEach(p => {
      const pageNum = p.pageNumber || 1
      if (!pageMap.has(pageNum)) pageMap.set(pageNum, [])
      pageMap.get(pageNum)!.push(p)
    })

    // Overlay translated text on existing pages
    pageMap.forEach((paras, pageNum) => {
      const pageIndex = pageNum - 1
      if (pageIndex >= doc.getPageCount()) return
      
      const page = doc.getPage(pageIndex)
      const { width, height } = page.getSize()
      
      paras.forEach(p => {
        if (!p.boundingBox || p.boundingBox.length < 8 || !p.text) return
        
        const [x1, y1] = p.boundingBox
        const x = x1 * width
        const y = height - (y1 * height) // PDF y is bottom-up
        
        const boxHeight = Math.abs(p.boundingBox[5] - p.boundingBox[1]) * height
        const fontSize = Math.max(8, Math.min(boxHeight * 0.8, 14))
        
        try {
          page.drawText(p.text, {
            x,
            y: y - fontSize,
            font: fontRegular,
            size: fontSize,
            color: rgb(0, 0, 0),
            maxWidth: (p.boundingBox[2] - p.boundingBox[0]) * width
          })
        } catch (err) {
          console.warn('Text overlay failed:', err)
        }
      })
    })
  } else if (preserveLayout && paragraphs.some(p => p.boundingBox)) {
    // Layout mode without original PDF - create blank pages with positioned text
    doc = await PDFDocument.create()
    doc.registerFontkit(fontkit as any)
    
    const fontRegularBytes = fs.readFileSync(FONT_REGULAR)
    const fontRegular = await doc.embedFont(fontRegularBytes)

    const pageMap = new Map<number, typeof paragraphs>()
    paragraphs.forEach(p => {
      const pageNum = p.pageNumber || 1
      if (!pageMap.has(pageNum)) pageMap.set(pageNum, [])
      pageMap.get(pageNum)!.push(p)
    })

    for (let i = 1; i <= totalPages; i++) {
      const page = doc.addPage()
      const { width, height} = page.getSize()
      const paras = pageMap.get(i) || []
      
      paras.forEach(p => {
        if (!p.boundingBox || p.boundingBox.length < 8 || !p.text) return
        const [x1, y1] = p.boundingBox
        const x = x1 * width
        const y = height - (y1 * height)
        const boxHeight = Math.abs(p.boundingBox[5] - p.boundingBox[1]) * height
        const fontSize = Math.max(8, Math.min(boxHeight * 0.8, 14))
        
        try {
          page.drawText(p.text, {
            x, y,
            font: fontRegular,
            size: fontSize,
            color: rgb(0, 0, 0),
            maxWidth: width - x - 10
          })
        } catch (err) {
          console.warn('Text draw failed:', err)
        }
      })
    }
  } else {
    // Flow mode: standard paragraph layout
    doc = await PDFDocument.create()
    doc.registerFontkit(fontkit as any)
    
    const fontRegularBytes = fs.readFileSync(FONT_REGULAR)
    const fontBoldBytes = fs.readFileSync(FONT_BOLD)
    const fontRegular = await doc.embedFont(fontRegularBytes)
    const fontBold = await doc.embedFont(fontBoldBytes)

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
