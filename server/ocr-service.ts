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

/**
 * Gets a searchable PDF from Azure Document Intelligence using the REST API
 * This is the official Azure searchable PDF output with embedded text layer
 */
export async function getSearchablePDF(
  filePath: string,
  endpoint: string,
  apiKey: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pdfBytes = fs.readFileSync(filePath)
    const url = new URL(`${endpoint}/formrecognizer/documentModels/prebuilt-read:analyze?api-version=2023-07-31&output=pdf`)
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Length': pdfBytes.length
      }
    }

    const protocol = url.protocol === 'https:' ? https : http
    const req = protocol.request(url, options, (res) => {
      if (res.statusCode === 202) {
        // Get the operation location from response header
        const operationLocation = res.headers['operation-location'] as string
        if (!operationLocation) {
          return reject(new Error('No operation-location header in response'))
        }

        // Poll for result
        const pollInterval = setInterval(() => {
          const pollUrl = new URL(operationLocation)
          const pollOptions = {
            method: 'GET',
            headers: { 'Ocp-Apim-Subscription-Key': apiKey }
          }

          protocol.request(pollUrl, pollOptions, (pollRes) => {
            let data = ''
            pollRes.on('data', chunk => data += chunk)
            pollRes.on('end', () => {
              try {
                const result = JSON.parse(data)
                if (result.status === 'succeeded') {
                  clearInterval(pollInterval)
                  // The analyzedDocument.content is available, but we need the PDF
                  // Download the PDF from the analyzeResult.content field
                  const pdfUrl = `${operationLocation}/analyzeResults/pdf`
                  downloadPDF(pdfUrl, apiKey, outputPath, resolve, reject)
                } else if (result.status === 'failed') {
                  clearInterval(pollInterval)
                  reject(new Error(result.error?.message || 'OCR failed'))
                }
              } catch (e) {
                clearInterval(pollInterval)
                reject(e)
              }
            })
          }).on('error', (e) => {
            clearInterval(pollInterval)
            reject(e)
          }).end()
        }, 2000)
      } else {
        reject(new Error(`Unexpected status code: ${res.statusCode}`))
      }
    })

    req.on('error', reject)
    req.write(pdfBytes)
    req.end()
  })
}

function downloadPDF(
  url: string,
  apiKey: string,
  outputPath: string,
  resolve: () => void,
  reject: (err: Error) => void
) {
  const parsedUrl = new URL(url)
  const options = {
    method: 'GET',
    headers: { 'Ocp-Apim-Subscription-Key': apiKey }
  }

  const protocol = parsedUrl.protocol === 'https:' ? https : http
  protocol.request(parsedUrl, options, (res) => {
    const writeStream = fs.createWriteStream(outputPath)
    res.pipe(writeStream)
    writeStream.on('finish', () => {
      writeStream.close()
      resolve()
    })
    writeStream.on('error', reject)
  }).on('error', reject).end()
}
