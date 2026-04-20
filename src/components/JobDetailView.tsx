import { useState, useEffect } from 'react'
import { Job, useAppStore } from '../store/appStore'
import PDFViewer from './PDFViewer'
import OCRPanel from './OCRPanel'
import TranslationPanel from './TranslationPanel'
import ProgressBar from './ProgressBar'
import AccuracyBadge from './AccuracyBadge'

interface Language { code: string; name: string; nativeName: string }

const FALLBACK_LANGS: Language[] = [
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'zh-Hans', name: 'Chinese Simplified', nativeName: '中文' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
]

export default function JobDetailView({ job }: { job: Job }) {
  const { updateJob } = useAppStore()
  const [languages, setLanguages] = useState<Language[]>(FALLBACK_LANGS)
  const [panel, setPanel] = useState<'ocr' | 'translation'>('ocr')

  useEffect(() => {
    fetch('/api/languages').then(r => r.json()).then((langs: Language[]) => {
      if (langs?.length > 0) setLanguages(langs)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (job.status === 'done') setPanel('translation')
  }, [job.status])

  const handleTranslate = async () => {
    updateJob(job.id, { status: 'translating', translateProgress: 0, error: null })
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs: job.ocrParagraphs.map(p => ({ id: p.id, text: p.text })),
          targetLanguage: job.selectedLanguage,
          jobId: job.id
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error)
      }
      const result = await res.json()
      const conf = result.reduce((a: number, r: any) => a + r.confidence, 0) / result.length
      updateJob(job.id, { status: 'done', translatedParagraphs: result, overallTranslationConfidence: conf, translateProgress: 100 })
    } catch (e: any) {
      updateJob(job.id, { status: 'ocr-done', error: e.message })
    }
  }

  const handleExport = async (type: 'pdf' | 'word') => {
    const paras = job.translatedParagraphs.map(p => ({ text: p.translatedText }))
    const title = job.fileName.replace('.pdf', '') + '_translated'
    const res = await fetch(`/api/export/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs: paras, title })
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.${type === 'pdf' ? 'pdf' : 'docx'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-5 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-white font-semibold truncate max-w-xs">{job.fileName}</span>

        {(job.status === 'ocr-done' || job.status === 'done') && (
          <span className="text-gray-400 text-sm">{job.pageCount} pages · {job.ocrParagraphs.length} paragraphs</span>
        )}

        {job.status !== 'ocr-running' && (
          <div className="flex bg-gray-700 rounded-lg p-0.5 ml-2">
            <button onClick={() => setPanel('ocr')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${panel === 'ocr' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}>
              OCR
            </button>
            <button onClick={() => setPanel('translation')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${panel === 'translation' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:text-white'}`}>
              Translation
            </button>
          </div>
        )}

        {job.status === 'ocr-done' && (
          <>
            <select value={job.selectedLanguage}
              onChange={e => updateJob(job.id, { selectedLanguage: e.target.value })}
              className="bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-1.5 text-sm">
              {languages.map(l => <option key={l.code} value={l.code}>{l.name} ({l.nativeName})</option>)}
            </select>
            <button onClick={handleTranslate}
              className="px-5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium">
              🌐 Translate
            </button>
          </>
        )}

        {job.status === 'translating' && (
          <span className="text-purple-400 text-sm animate-pulse">Translating...</span>
        )}

        {job.status === 'done' && (
          <div className="ml-auto flex gap-2">
            <button onClick={() => handleExport('pdf')}
              className="px-4 py-1.5 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-medium">
              ⬇ PDF
            </button>
            <button onClick={() => handleExport('word')}
              className="px-4 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium">
              ⬇ Word
            </button>
          </div>
        )}

        {(job.status === 'ocr-done' || job.status === 'done' || job.status === 'translating') && (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-gray-500 text-xs">OCR</span>
            <AccuracyBadge value={job.overallOCRConfidence} />
          </div>
        )}
      </div>

      {job.status === 'ocr-running' && (
        <div className="px-5 py-3 border-b border-gray-700">
          <p className="text-blue-400 text-xs mb-2">Running OCR via Azure Document Intelligence...</p>
          <ProgressBar value={job.ocrProgress} label="Processing pages" />
        </div>
      )}
      {job.status === 'translating' && (
        <div className="px-5 py-3 border-b border-gray-700">
          <ProgressBar value={job.translateProgress} label="Translating paragraphs" />
        </div>
      )}

      {job.error && (
        <div className="mx-5 mt-3 bg-red-900/50 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm">
          ⚠️ {job.error}
          {(job.error.includes('credentials') || job.error.includes('configured')) && (
            <span className="ml-2 text-yellow-400 font-semibold">→ Open ⚙️ Settings</span>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r border-gray-700 overflow-hidden">
          <PDFViewer fileData={job.fileData} />
        </div>
        <div className="w-1/2 overflow-hidden bg-gray-900">
          {job.status === 'ocr-running' ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="text-4xl mb-3 animate-spin">⏳</div>
              <p className="text-sm">OCR in progress...</p>
            </div>
          ) : panel === 'ocr' ? (
            <OCRPanel paragraphs={job.ocrParagraphs} overallConfidence={job.overallOCRConfidence} />
          ) : (
            <TranslationPanel
              ocrParagraphs={job.ocrParagraphs}
              translatedParagraphs={job.translatedParagraphs}
              overallOCRConfidence={job.overallOCRConfidence}
              overallTranslationConfidence={job.overallTranslationConfidence}
            />
          )}
        </div>
      </div>
    </div>
  )
}
