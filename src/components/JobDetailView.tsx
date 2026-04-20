import { useState, useEffect } from 'react'
import { Job, Translation, useAppStore } from '../store/appStore'
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
  // 'ocr' | langCode (e.g. 'es', 'fr')
  const [activePanel, setActivePanel] = useState<string>('ocr')
  const [currentPage, setCurrentPage] = useState(1)
  const [showLangSelector, setShowLangSelector] = useState(false)
  const [pendingLang, setPendingLang] = useState('es')

  useEffect(() => {
    fetch('/api/languages').then(r => r.json()).then((langs: Language[]) => {
      if (langs?.length > 0) {
        setLanguages(langs)
        setPendingLang(langs[0].code)
      }
    }).catch(() => {})
  }, [])

  // When first translation finishes, auto-switch to it
  useEffect(() => {
    const codes = Object.keys(job.translations)
    if (codes.length > 0 && job.status !== 'translating') {
      setActivePanel(codes[codes.length - 1])
    }
  }, [job.status])

  const getLangName = (code: string) => {
    return languages.find(l => l.code === code)?.name ?? code
  }

  // Languages not yet translated
  const translatedCodes = Object.keys(job.translations)
  const availableLangs = languages.filter(l => !translatedCodes.includes(l.code))

  const handleTranslate = async (langCode: string) => {
    const langName = getLangName(langCode)
    updateJob(job.id, { status: 'translating', translateProgress: 0, error: null, selectedLanguage: langCode })
    setShowLangSelector(false)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs: job.ocrParagraphs.map(p => ({ id: p.id, text: p.text })),
          targetLanguage: langCode,
          jobId: job.id
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error)
      }
      const result = await res.json()
      const conf = result.reduce((a: number, r: any) => a + r.confidence, 0) / result.length
      const newTranslation: Translation = { paragraphs: result, confidence: conf, languageName: langName }
      const newTranslations = { ...job.translations, [langCode]: newTranslation }
      updateJob(job.id, {
        status: 'done',
        translatedParagraphs: result,
        overallTranslationConfidence: conf,
        translateProgress: 100,
        translations: newTranslations
      })
      setActivePanel(langCode)
    } catch (e: any) {
      updateJob(job.id, { status: translatedCodes.length > 0 ? 'done' : 'ocr-done', error: e.message })
    }
  }

  const handleExport = async (type: 'pdf' | 'word') => {
    const translation = activePanel !== 'ocr' ? job.translations[activePanel] : null
    const paras = translation ? translation.paragraphs.map(p => ({ text: p.translatedText })) : job.ocrParagraphs.map(p => ({ text: p.text }))
    const langSuffix = translation ? `_${activePanel}` : '_ocr'
    const title = job.fileName.replace('.pdf', '') + langSuffix
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

  const canTranslate = job.status === 'ocr-done' || job.status === 'done'
  const isTranslating = job.status === 'translating'

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-white font-semibold truncate max-w-xs text-sm">{job.fileName}</span>

        {(job.status === 'ocr-done' || job.status === 'done') && (
          <span className="text-gray-400 text-xs">{job.pageCount}p · {job.ocrParagraphs.length} paras</span>
        )}

        {/* Toggle buttons: OCR + each translated language */}
        {job.status !== 'ocr-running' && (
          <div className="flex bg-gray-700 rounded-lg p-0.5 gap-0.5 flex-wrap">
            <button
              onClick={() => setActivePanel('ocr')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${activePanel === 'ocr' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}>
              OCR
            </button>
            {translatedCodes.map(code => (
              <button
                key={code}
                onClick={() => setActivePanel(code)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${activePanel === code ? 'bg-purple-600 text-white' : 'text-gray-300 hover:text-white'}`}>
                {getLangName(code)}
              </button>
            ))}
          </div>
        )}

        {/* Translate button / language selector */}
        {canTranslate && !isTranslating && (
          <div className="relative">
            {showLangSelector ? (
              <div className="flex items-center gap-1">
                <select
                  value={pendingLang}
                  onChange={e => setPendingLang(e.target.value)}
                  className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1 text-xs">
                  {availableLangs.map(l => (
                    <option key={l.code} value={l.code}>{l.name} ({l.nativeName})</option>
                  ))}
                </select>
                <button
                  onClick={() => handleTranslate(pendingLang)}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium">
                  Go
                </button>
                <button
                  onClick={() => setShowLangSelector(false)}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs">
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setShowLangSelector(true) }}
                disabled={availableLangs.length === 0}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg text-xs font-medium">
                🌐 {translatedCodes.length === 0 ? 'Translate' : '+ Language'}
              </button>
            )}
          </div>
        )}

        {isTranslating && (
          <span className="text-purple-400 text-xs animate-pulse">Translating to {getLangName(job.selectedLanguage)}...</span>
        )}

        {/* Export + accuracy on the right */}
        <div className="ml-auto flex items-center gap-2">
          {(job.status === 'ocr-done' || job.status === 'done') && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-xs">OCR</span>
              <AccuracyBadge value={job.overallOCRConfidence} />
            </div>
          )}
          {(job.status === 'done') && (
            <>
              <button onClick={() => handleExport('pdf')}
                className="px-3 py-1 bg-green-700 hover:bg-green-800 text-white rounded-lg text-xs font-medium">
                ⬇ PDF
              </button>
              <button onClick={() => handleExport('word')}
                className="px-3 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-medium">
                ⬇ Word
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress bars */}
      {job.status === 'ocr-running' && (
        <div className="px-5 py-3 border-b border-gray-700">
          <p className="text-blue-400 text-xs mb-2">Running OCR via Azure Document Intelligence...</p>
          <ProgressBar value={job.ocrProgress} label="Processing pages" />
        </div>
      )}
      {isTranslating && (
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

      {/* Main content: PDF left, panel right */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r border-gray-700 overflow-hidden">
          <PDFViewer
            fileData={job.fileData}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        </div>
        <div className="w-1/2 overflow-hidden bg-gray-900">
          {job.status === 'ocr-running' ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="text-4xl mb-3 animate-spin">⏳</div>
              <p className="text-sm">OCR in progress...</p>
            </div>
          ) : activePanel === 'ocr' ? (
            <OCRPanel
              paragraphs={job.ocrParagraphs}
              overallConfidence={job.overallOCRConfidence}
              currentPage={currentPage}
            />
          ) : job.translations[activePanel] ? (
            <TranslationPanel
              ocrParagraphs={job.ocrParagraphs}
              translatedParagraphs={job.translations[activePanel].paragraphs}
              overallTranslationConfidence={job.translations[activePanel].confidence}
              languageName={job.translations[activePanel].languageName}
              currentPage={currentPage}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">Select a translation above</div>
          )}
        </div>
      </div>
    </div>
  )
}
