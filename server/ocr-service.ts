import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer'
import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'

export interface OCRParagraph {
  id: string
  pageNumber: number
  text: string
  confidence: number
  boundingBox?: number[] // [x1, y1, x2, y2, x3, y3, x4, y4] normalized 0-1
}

export interface OCRResult {
  paragraphs: OCRParagraph[]
  overallConfidence: number
  pageCount: number
  searchablePdfPath?: string // Path to Azure-generated searchable PDF
}

export async function runOCR(
  filePath: string,
  endpoint: string,
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<OCRResult> {
  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey))
  const fileStream = fs.createReadStream(filePath)

  let pollCount = 0
  const pollInterval = setInterval(() => {
    pollCount++
    onProgress?.(Math.min(pollCount * 4, 90), 100)
  }, 2000)

  const poller = await client.beginAnalyzeDocument('prebuilt-read', fileStream)
  const result = await poller.pollUntilDone()

  clearInterval(pollInterval)
  onProgress?.(100, 100)

  const paragraphs: OCRParagraph[] = []
  const allWordConfs: number[] = []

  result.pages?.forEach(page => {
    page.words?.forEach(word => allWordConfs.push(word.confidence ?? 1))
  })

  const avgConf = allWordConfs.length > 0
    ? allWordConfs.reduce((a, b) => a + b, 0) / allWordConfs.length
    : 0.95

  result.paragraphs?.forEach((para, idx) => {
    const boundingRegion = para.boundingRegions?.[0]
    const polygon = boundingRegion?.polygon
    paragraphs.push({
      id: `para-${idx}`,
      pageNumber: boundingRegion?.pageNumber ?? 1,
      text: para.content,
      confidence: avgConf,
      boundingBox: polygon ? [
        polygon[0].x, polygon[0].y,
        polygon[1].x, polygon[1].y,
        polygon[2].x, polygon[2].y,
        polygon[3].x, polygon[3].y
      ] : undefined
    })
  })

  if (paragraphs.length === 0) {
    result.pages?.forEach(page => {
      page.lines?.forEach((line, idx) => {
        const polygon = line.polygon
        paragraphs.push({
          id: `line-${page.pageNumber}-${idx}`,
          pageNumber: page.pageNumber ?? 1,
          text: line.content,
          confidence: avgConf,
          boundingBox: polygon ? [
            polygon[0].x, polygon[0].y,
            polygon[1].x, polygon[1].y,
            polygon[2].x, polygon[2].y,
            polygon[3].x, polygon[3].y
          ] : undefined
        })
      })
    })
  }

  const overallConfidence = paragraphs.length > 0
    ? paragraphs.reduce((a, b) => a + b.confidence, 0) / paragraphs.length
    : 0

  return { paragraphs, overallConfidence, pageCount: result.pages?.length ?? 0 }
}
