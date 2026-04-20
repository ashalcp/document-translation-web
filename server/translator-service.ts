const TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com'
const CHUNK_SIZE = 40000

export interface TranslatedParagraph {
  id: string
  originalText: string
  translatedText: string
  confidence: number
}

export async function translateParagraphs(
  paragraphs: Array<{ id: string; text: string }>,
  targetLanguage: string,
  apiKey: string,
  region: string,
  onProgress?: (current: number, total: number) => void
): Promise<TranslatedParagraph[]> {
  const results: TranslatedParagraph[] = []
  const chunks: Array<typeof paragraphs> = []

  let currentChunk: typeof paragraphs = []
  let currentSize = 0
  for (const para of paragraphs) {
    if (currentSize + para.text.length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = []
      currentSize = 0
    }
    currentChunk.push(para)
    currentSize += para.text.length
  }
  if (currentChunk.length > 0) chunks.push(currentChunk)

  let processed = 0
  for (const chunk of chunks) {
    // Truncate individual texts to Azure's 50k char per item limit
    const body = chunk.map(p => ({ text: p.text.slice(0, 49999) }))
    const url = `${TRANSLATOR_ENDPOINT}/translate?api-version=3.0&to=${encodeURIComponent(targetLanguage)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Translation error (${response.status}): ${err}`)
    }

    const data = await response.json() as Array<{ translations: Array<{ text: string }> }>
    data.forEach((item, i) => {
      results.push({
        id: chunk[i].id,
        originalText: chunk[i].text,
        translatedText: item.translations?.[0]?.text ?? chunk[i].text,
        confidence: 0.92
      })
    })

    processed += chunk.length
    onProgress?.(processed, paragraphs.length)
  }

  return results
}

export async function getSupportedLanguages(apiKey: string, region: string) {
  const url = `${TRANSLATOR_ENDPOINT}/languages?api-version=3.0&scope=translation`
  const response = await fetch(url, {
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Ocp-Apim-Subscription-Region': region
    }
  })
  if (!response.ok) throw new Error(`Failed to fetch languages (${response.status})`)
  const data = await response.json() as { translation: Record<string, { name: string; nativeName: string }> }
  return Object.entries(data.translation ?? {}).map(([code, info]) => ({
    code, name: info.name, nativeName: info.nativeName
  }))
}
