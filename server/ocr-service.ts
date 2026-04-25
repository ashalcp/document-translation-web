import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer'
import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'
import * as path from 'path'
import * as os from 'os'

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
 * Get searchable PDF from Azure Document Intelligence using official REST API
 * This uses the output=pdf parameter as documented in Azure docs
 */
export async function getSearchablePDF(
  filePath: string,
  endpoint: string,
  apiKey: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfBytes = fs.readFileSync(filePath)
    const apiVersion = '2024-11-30'
    // Enable searchable PDF output with font/style detection
    const url = new URL(`${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${apiVersion}&output=pdf&features=styleFont`)
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Length': pdfBytes.length
      }
    }

    console.log('[Searchable PDF] Starting analysis with font/style detection...')
    console.log('[Searchable PDF] URL:', url.toString())
    const protocol = url.protocol === 'https:' ? https : http
    const req = protocol.request(url, options, (res) => {
      console.log('[Searchable PDF] Initial response status:', res.statusCode)
      
      if (res.statusCode === 202) {
        const operationLocation = res.headers['operation-location'] as string
        if (!operationLocation) {
          return reject(new Error('No operation-location header in response'))
        }

        console.log('[Searchable PDF] Operation location:', operationLocation)
        
        // Poll for completion
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
                console.log('[Searchable PDF] Poll status:', result.status)
                
                if (result.status === 'succeeded') {
                  clearInterval(pollInterval)
                  console.log('[Searchable PDF] Analysis succeeded!')
                  
                  // Extract result ID from operation location
                  // Format: {endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/{resultId}?api-version=xxx
                  const match = operationLocation.match(/\/analyzeResults\/([a-f0-9-]+)/i)
                  if (!match) {
                    return reject(new Error('Could not extract result ID from operation location'))
                  }
                  const resultId = match[1]
                  const pdfUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/${resultId}/pdf?api-version=${apiVersion}`
                  
                  console.log('[Searchable PDF] Result ID:', resultId)
                  console.log('[Searchable PDF] Download URL:', pdfUrl)
                  
                  downloadSearchablePDF(pdfUrl, apiKey, resolve, reject)
                } else if (result.status === 'failed') {
                  clearInterval(pollInterval)
                  console.error('[Searchable PDF] Analysis failed:', result.error)
                  reject(new Error(result.error?.message || 'Analysis failed'))
                }
              } catch (e) {
                clearInterval(pollInterval)
                console.error('[Searchable PDF] Polling error:', e)
                reject(e)
              }
            })
          }).on('error', (e) => {
            clearInterval(pollInterval)
            console.error('[Searchable PDF] Request error:', e)
            reject(e)
          }).end()
        }, 2000)
      } else {
        let errorData = ''
        res.on('data', chunk => errorData += chunk)
        res.on('end', () => {
          console.error('[Searchable PDF] Unexpected status:', res.statusCode, errorData)
          reject(new Error(`Unexpected status code ${res.statusCode}: ${errorData}`))
        })
      }
    })

    req.on('error', (err) => {
      console.error('[Searchable PDF] Request error:', err)
      reject(err)
    })
    req.write(pdfBytes)
    req.end()
  })
}

function downloadSearchablePDF(
  url: string,
  apiKey: string,
  resolve: (path: string) => void,
  reject: (err: Error) => void
) {
  const parsedUrl = new URL(url)
  const options = {
    method: 'GET',
    headers: { 'Ocp-Apim-Subscription-Key': apiKey }
  }

  const outputPath = path.join(os.tmpdir(), `searchable-${Date.now()}.pdf`)
  const protocol = parsedUrl.protocol === 'https:' ? https : http
  
  console.log('[Searchable PDF] Downloading from:', url)
  
  protocol.request(parsedUrl, options, (res) => {
    console.log('[Searchable PDF] Download response status:', res.statusCode)
    console.log('[Searchable PDF] Content-Type:', res.headers['content-type'])
    
    if (res.statusCode !== 200) {
      let errorData = ''
      res.on('data', chunk => errorData += chunk)
      res.on('end', () => {
        console.error('[Searchable PDF] Download failed:', errorData)
        reject(new Error(`Failed to download PDF (${res.statusCode}): ${errorData}`))
      })
      return
    }

    const writeStream = fs.createWriteStream(outputPath, { encoding: 'binary' })
    res.pipe(writeStream)
    writeStream.on('finish', () => {
      writeStream.close()
      const stats = fs.statSync(outputPath)
      console.log('[Searchable PDF] Downloaded successfully:', outputPath)
      console.log('[Searchable PDF] File size:', stats.size, 'bytes')
      resolve(outputPath)
    })
    writeStream.on('error', (err) => {
      console.error('[Searchable PDF] Write error:', err)
      reject(err)
    })
  }).on('error', (err) => {
    console.error('[Searchable PDF] Download request error:', err)
    reject(err)
  }).end()
}
