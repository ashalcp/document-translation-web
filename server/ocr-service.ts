import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer'
import * as fs from 'fs'

export interface OCRParagraph {
  id: string
  pageNumber: number
  text: string
  confidence: number
}

export interface OCRResult {
  paragraphs: OCRParagraph[]
  overallConfidence: number
  pageCount: number
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
    paragraphs.push({
      id: `para-${idx}`,
      pageNumber: para.boundingRegions?.[0]?.pageNumber ?? 1,
      text: para.content,
      confidence: avgConf
    })
  })

  if (paragraphs.length === 0) {
    result.pages?.forEach(page => {
      page.lines?.forEach((line, idx) => {
        paragraphs.push({
          id: `line-${page.pageNumber}-${idx}`,
          pageNumber: page.pageNumber ?? 1,
          text: line.content,
          confidence: avgConf
        })
      })
    })
  }

  const overallConfidence = paragraphs.length > 0
    ? paragraphs.reduce((a, b) => a + b.confidence, 0) / paragraphs.length
    : 0

  return { paragraphs, overallConfidence, pageCount: result.pages?.length ?? 0 }
}
