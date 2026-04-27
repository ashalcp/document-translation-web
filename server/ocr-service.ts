import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'

export interface OCRLine {
  boundingBox: number[]    // flat [x1,y1,x2,y2,x3,y3,x4,y4] INCHES, tight single-row
  text: string             // original line text
  fontSize: number         // derived from line height × 72 × 0.72
  fontWeight?: string
  fontStyle?: string
  color?: string
  backgroundColor?: string
}

export interface OCRParagraph {
  id: string
  pageNumber: number
  text: string
  confidence: number
  boundingBox?: number[]   // [x1,y1,x2,y2,x3,y3,x4,y4] in INCHES (full paragraph)
  fontSize?: number        // from first line
  fontWeight?: string
  fontStyle?: string
  color?: string
  backgroundColor?: string
  fontFamily?: string
  lines?: OCRLine[]        // individual lines within this paragraph (for precise placement)
}

export interface OCRResult {
  paragraphs: OCRParagraph[]
  overallConfidence: number
  pageCount: number
  searchablePdfUrl?: string
  searchablePdfPath?: string // Local path to downloaded searchable PDF
}

export async function runOCR(
  filePath: string,
  endpoint: string,
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<OCRResult> {
  return new Promise((resolve, reject) => {
    const pdfBytes = fs.readFileSync(filePath)
    const apiVersion = '2024-11-30'
    
    const analyzeUrl = new URL(`${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze`)
    analyzeUrl.searchParams.append('api-version', apiVersion)
    analyzeUrl.searchParams.append('features', 'styleFont')
    analyzeUrl.searchParams.append('output', 'pdf')
    
    const analyzeOptions: https.RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Length': pdfBytes.length
      }
    }
    
    console.log('🚀 Submitting PDF with styleFont + searchable PDF...')
    
    const protocol = analyzeUrl.protocol === 'https:' ? https : http
    const analyzeReq = protocol.request(analyzeUrl, analyzeOptions, (res) => {
      if (res.statusCode !== 202) {
        reject(new Error(`Azure OCR failed: ${res.statusCode}`))
        return
      }
      
      const operationLocation = res.headers['operation-location'] as string
      if (!operationLocation) {
        reject(new Error('No operation-location header'))
        return
      }
      
      console.log('✓ Analysis submitted, polling...')
      
      let pollCount = 0
      const pollInterval = setInterval(() => {
        pollCount++
        onProgress?.(Math.min(pollCount * 4, 90), 100)
        
        const pollUrl = new URL(operationLocation)
        const pollOptions: https.RequestOptions = {
          method: 'GET',
          headers: { 'Ocp-Apim-Subscription-Key': apiKey }
        }
        
        const pollReq = protocol.request(pollUrl, pollOptions, (pollRes) => {
          let data = ''
          pollRes.on('data', chunk => data += chunk)
          pollRes.on('end', () => {
            try {
              const result = JSON.parse(data)
              
              if (result.status === 'succeeded') {
                clearInterval(pollInterval)
                onProgress?.(100, 100)
                console.log('✓ OCR completed')

                // Download searchable PDF to a local temp file
                const resultIdMatch = operationLocation.match(/\/analyzeResults\/([a-f0-9-]+)/i)
                const resultId = resultIdMatch ? resultIdMatch[1] : null
                let searchablePdfPath: string | undefined

                const tryDownload = async () => {
                  if (!resultId) return
                  const pdfUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/${resultId}/pdf?api-version=${apiVersion}`
                  const outPath = require('path').join(require('os').tmpdir(), `searchable-${Date.now()}.pdf`)
                  try {
                    await downloadSearchablePDF(pdfUrl, apiKey, outPath)
                    searchablePdfPath = outPath
                    console.log('✓ Searchable PDF downloaded:', searchablePdfPath)
                  } catch (e: any) {
                    console.warn('⚠ Could not download searchable PDF:', e.message)
                  }
                }

                tryDownload().then(() => {
                  const ocrResult = parseOCRResult(result.analyzeResult, searchablePdfPath)
                  resolve(ocrResult)
                }).catch(reject)
              } else if (result.status === 'failed') {
                clearInterval(pollInterval)
                reject(new Error(`OCR failed: ${result.error?.message || 'Unknown'}`))
              }
            } catch (err: any) {
              clearInterval(pollInterval)
              reject(new Error(`Parse error: ${err.message}`))
            }
          })
        })
        
        pollReq.on('error', (err) => {
          clearInterval(pollInterval)
          reject(err)
        })
        
        pollReq.end()
      }, 2000)
    })
    
    analyzeReq.on('error', reject)
    analyzeReq.write(pdfBytes)
    analyzeReq.end()
  })
}

function parseOCRResult(analyzeResult: any, searchablePdfPath?: string): OCRResult {
  const paragraphs: OCRParagraph[] = []

  // ── Confidence ──────────────────────────────────────────────────────────
  const allWordConfs: number[] = []
  analyzeResult.pages?.forEach((page: any) => {
    page.words?.forEach((word: any) => allWordConfs.push(word.confidence ?? 1))
  })
  const avgConf = allWordConfs.length > 0
    ? allWordConfs.reduce((a: number, b: number) => a + b, 0) / allWordConfs.length
    : 0.95

  // ── Build style ranges ──────────────────────────────────────────────────
  const styleRanges: Array<{
    start: number; end: number
    fontWeight?: string; color?: string; fontStyle?: string; backgroundColor?: string
  }> = []
  if (analyzeResult.styles) {
    for (const style of analyzeResult.styles) {
      if (!style.spans) continue
      const info: { fontWeight?: string; color?: string; fontStyle?: string; backgroundColor?: string } = {}
      if (style.fontWeight && style.fontWeight !== 'normal') info.fontWeight = style.fontWeight
      if (style.color) info.color = style.color
      if (style.fontStyle && style.fontStyle !== 'normal') info.fontStyle = style.fontStyle
      if (style.backgroundColor) info.backgroundColor = style.backgroundColor
      if (Object.keys(info).length === 0) continue
      for (const span of style.spans) {
        styleRanges.push({ start: span.offset, end: span.offset + span.length, ...info })
      }
    }
  }

  function getStyleAt(offset: number): { fontWeight?: string; color?: string; fontStyle?: string; backgroundColor?: string } {
    let fontWeight: string | undefined
    let color: string | undefined
    let fontStyle: string | undefined
    let backgroundColor: string | undefined
    for (const r of styleRanges) {
      if (offset >= r.start && offset < r.end) {
        if (r.fontWeight && !fontWeight) fontWeight = r.fontWeight
        if (r.color && !color) color = r.color
        if (r.fontStyle && !fontStyle) fontStyle = r.fontStyle
        if (r.backgroundColor && !backgroundColor) backgroundColor = r.backgroundColor
      }
    }
    return { fontWeight, color, fontStyle, backgroundColor }
  }

  // ── Build page lines map (used for font size AND line-level placement) ──
  const pageLines: Map<number, any[]> = new Map()
  analyzeResult.pages?.forEach((page: any) => {
    pageLines.set(page.pageNumber, page.lines ?? [])
  })

  // ── Extract PARAGRAPHS (for coherent translation) ───────────────────────
  analyzeResult.paragraphs?.forEach((para: any, idx: number) => {
    const boundingRegion = para.boundingRegions?.[0]
    const polygon = boundingRegion?.polygon
    const pageNum: number = boundingRegion?.pageNumber ?? 1

    const boundingBox = polygon && polygon.length === 8 ? polygon as number[] : undefined

    const paraOffset: number = para.spans?.[0]?.offset ?? -1
    const paraLength: number = para.spans?.[0]?.length ?? 0

    // Style from first character of paragraph
    const { fontWeight, color, fontStyle, backgroundColor } = paraOffset >= 0
      ? getStyleAt(paraOffset)
      : {}

    // ── Find all Azure lines that belong to this paragraph ─────────────────
    // Each line has a tight single-row bounding box — perfect for precise placement
    const linesOnPage = pageLines.get(pageNum) ?? []
    const ocrLines: OCRLine[] = []
    let fontSize: number | undefined

    for (const line of linesOnPage) {
      const lineOffset: number = line.spans?.[0]?.offset ?? -1
      const lineLength: number = line.spans?.[0]?.length ?? 0
      // Line belongs to this paragraph if its span falls within the paragraph span
      if (lineOffset < paraOffset || lineOffset >= paraOffset + paraLength) continue

      const poly: number[] = line.polygon
      if (!poly || poly.length !== 8) continue

      const lineHeightInches = poly[7] - poly[1]  // y4 - y1
      const lineFontSize = lineHeightInches * 72 * 0.72
      if (!fontSize) fontSize = lineFontSize  // use first line's size as paragraph default

      const lineStyle = getStyleAt(lineOffset)
      ocrLines.push({
        boundingBox: poly,
        text: line.content,
        fontSize: lineFontSize,
        fontWeight: lineStyle.fontWeight,
        fontStyle: lineStyle.fontStyle,
        color: lineStyle.color,
        backgroundColor: lineStyle.backgroundColor
      })
    }

    paragraphs.push({
      id: `para-${idx}`,
      pageNumber: pageNum,
      text: para.content,
      confidence: avgConf,
      boundingBox,
      fontSize,
      fontWeight,
      fontStyle,
      color,
      backgroundColor,
      lines: ocrLines.length > 0 ? ocrLines : undefined
    })
  })

  const overallConfidence = avgConf

  const withBBox     = paragraphs.filter(p => p.boundingBox).length
  const withFontSize = paragraphs.filter(p => p.fontSize).length
  const withBold     = paragraphs.filter(p => p.fontWeight === 'bold').length
  const withColor    = paragraphs.filter(p => p.color).length
  const withBgColor  = paragraphs.filter(p => p.backgroundColor).length
  const totalLines   = paragraphs.reduce((n, p) => n + (p.lines?.length ?? 0), 0)
  console.log(`✓ Extracted ${paragraphs.length} paragraphs: ${withBBox} bbox, ${withFontSize} fontSize, ${withBold} bold, ${withColor} colored, ${withBgColor} with bgColor, ${totalLines} lines`)

  return {
    paragraphs,
    overallConfidence,
    pageCount: analyzeResult.pages?.length ?? 0,
    searchablePdfPath
  }
}

/**
 * Download searchable PDF from Azure
 */
export async function downloadSearchablePDF(
  searchablePdfUrl: string,
  apiKey: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(searchablePdfUrl)
    const protocol = url.protocol === 'https:' ? https : http
    
    const options: https.RequestOptions = {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey
      }
    }
    
    console.log('📥 Downloading searchable PDF from Azure...')
    
    const req = protocol.request(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download searchable PDF: ${res.statusCode}`))
        return
      }
      
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks)
        fs.writeFileSync(outputPath, pdfBuffer)
        console.log(`✓ Searchable PDF saved to ${outputPath}`)
        resolve()
      })
    })
    
    req.on('error', reject)
    req.end()
  })
}
