/**
 * Simple Translate Page
 *
 * Self-contained page that uses the Azure Document Translation Async Batch API.
 * Supports PDF, DOCX, PPTX, XLSX and other formats the Azure service accepts.
 *
 * Backend routes (server/simple-translate.ts):
 *   POST /api/simple-translate/start     — upload file + targetLang, returns jobId
 *   GET  /api/simple-translate/status/:jobId — poll status
 *   GET  /api/simple-translate/download/:jobId — download result
 */

import { useState, useRef, useCallback } from 'react'

// ── Supported languages ───────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'af', name: 'Afrikaans' },
  { code: 'ar', name: 'Arabic' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'cs', name: 'Czech' },
  { code: 'cy', name: 'Welsh' },
  { code: 'da', name: 'Danish' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'es', name: 'Spanish' },
  { code: 'et', name: 'Estonian' },
  { code: 'fa', name: 'Persian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fil', name: 'Filipino' },
  { code: 'fj', name: 'Fijian' },
  { code: 'fr', name: 'French' },
  { code: 'ga', name: 'Irish' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hr', name: 'Croatian' },
  { code: 'ht', name: 'Haitian Creole' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ko', name: 'Korean' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'mi', name: 'Māori' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ms', name: 'Malay' },
  { code: 'mt', name: 'Maltese' },
  { code: 'mww', name: 'Hmong Daw' },
  { code: 'nb', name: 'Norwegian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'or', name: 'Odia' },
  { code: 'otq', name: 'Querétaro Otomi' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese (Brazil)' },
  { code: 'pt-pt', name: 'Portuguese (Portugal)' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'sm', name: 'Samoan' },
  { code: 'sq', name: 'Albanian' },
  { code: 'sr-Cyrl', name: 'Serbian (Cyrillic)' },
  { code: 'sr-Latn', name: 'Serbian (Latin)' },
  { code: 'sv', name: 'Swedish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tlh-Latn', name: 'Klingon (Latin)' },
  { code: 'to', name: 'Tongan' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ty', name: 'Tahitian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'yua', name: 'Yucatec Maya' },
  { code: 'yue', name: 'Cantonese (Traditional)' },
  { code: 'zh-Hans', name: 'Chinese Simplified' },
  { code: 'zh-Hant', name: 'Chinese Traditional' },
]

// Accepted MIME types / extensions
const ACCEPTED = '.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.html,.htm,.odt,.odp,.ods,.tsv,.csv,.rtf,.xlf,.xliff,.mhtml'

type Stage = 'idle' | 'uploading' | 'translating' | 'done' | 'error'

export default function SimpleTranslatePage() {
  const [file, setFile] = useState<File | null>(null)
  const [targetLang, setTargetLang] = useState('fr')
  const [stage, setStage] = useState<Stage>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const reset = () => {
    stopPolling()
    setFile(null)
    setStage('idle')
    setStatusMsg('')
    setJobId(null)
    setErrorMsg('')
  }

  const handleFile = (f: File) => {
    setFile(f)
    setStage('idle')
    setErrorMsg('')
    setJobId(null)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }, [])

  const handleTranslate = async () => {
    if (!file) return
    stopPolling()
    setStage('uploading')
    setStatusMsg('Uploading document to Azure Blob Storage…')
    setErrorMsg('')

    try {
      // ── Step 1: Upload + submit job ──────────────────────────────────────
      const formData = new FormData()
      formData.append('file', file)
      formData.append('targetLang', targetLang)

      const startRes = await fetch('/api/simple-translate/start', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error ?? 'Failed to start translation.')

      const { jobId: newJobId } = startData
      setJobId(newJobId)
      setStage('translating')
      setStatusMsg('Translation job submitted. Waiting for Azure to process…')

      // ── Step 2: Poll status every 5 seconds ──────────────────────────────
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/simple-translate/status/${newJobId}`, {
            credentials: 'include',
          })
          const pollData = await pollRes.json()

          if (!pollRes.ok) {
            stopPolling()
            setStage('error')
            setErrorMsg(pollData.error ?? 'Status check failed.')
            return
          }

          const { status, error: jobError } = pollData
          setStatusMsg(`Azure status: ${status}`)

          if (status === 'Succeeded') {
            stopPolling()
            setStage('done')
            setStatusMsg('Translation complete! Your file is ready to download.')
          } else if (status === 'Failed' || status === 'Cancelled') {
            stopPolling()
            setStage('error')
            setErrorMsg(jobError ?? `Translation ended with status: ${status}`)
          }
        } catch (e: any) {
          stopPolling()
          setStage('error')
          setErrorMsg(e.message)
        }
      }, 5000)

    } catch (e: any) {
      setStage('error')
      setErrorMsg(e.message)
    }
  }

  const handleDownload = () => {
    if (!jobId) return
    window.location.href = `/api/simple-translate/download/${jobId}`
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const langName = LANGUAGES.find(l => l.code === targetLang)?.name ?? targetLang
  const isWorking = stage === 'uploading' || stage === 'translating'

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-8 overflow-y-auto bg-gray-950">
      {/* Header */}
      <div className="w-full max-w-xl mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">🌐 Simple Document Translate</h1>
        <p className="text-gray-400 text-sm">
          Upload any document and get a fully translated file back — powered by Azure Document
          Translation API. Supports PDF, DOCX, PPTX, XLSX and more.
        </p>
      </div>

      <div className="w-full max-w-xl space-y-5">

        {/* ── Drop zone ─────────────────────────────────────────────────── */}
        <div
          className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer p-8 flex flex-col items-center justify-center text-center
            ${dragging ? 'border-blue-400 bg-blue-900/20' : 'border-gray-600 hover:border-gray-500 bg-gray-900'}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !isWorking && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            disabled={isWorking}
          />
          {file ? (
            <>
              <div className="text-3xl mb-2">📄</div>
              <p className="text-white font-medium text-sm">{file.name}</p>
              <p className="text-gray-500 text-xs mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              {!isWorking && (
                <button
                  onClick={e => { e.stopPropagation(); reset() }}
                  className="mt-3 text-gray-500 hover:text-red-400 text-xs underline">
                  Remove
                </button>
              )}
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">📂</div>
              <p className="text-gray-300 text-sm font-medium">Drop a file here or click to browse</p>
              <p className="text-gray-600 text-xs mt-1">PDF · DOCX · PPTX · XLSX · TXT · HTML and more</p>
            </>
          )}
        </div>

        {/* ── Language selector ─────────────────────────────────────────── */}
        <div>
          <label className="block text-gray-400 text-xs mb-1.5 font-medium">Target Language</label>
          <select
            value={targetLang}
            onChange={e => setTargetLang(e.target.value)}
            disabled={isWorking}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.name} ({l.code})</option>
            ))}
          </select>
        </div>

        {/* ── Translate button ──────────────────────────────────────────── */}
        {stage !== 'done' && (
          <button
            onClick={handleTranslate}
            disabled={!file || isWorking}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm transition-colors">
            {isWorking ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                {stage === 'uploading' ? 'Uploading…' : `Translating to ${langName}…`}
              </span>
            ) : (
              `🌐 Translate to ${langName}`
            )}
          </button>
        )}

        {/* ── Status card ───────────────────────────────────────────────── */}
        {(isWorking || stage === 'done' || stage === 'error') && (
          <div className={`rounded-xl p-4 border text-sm
            ${stage === 'error'
              ? 'bg-red-950/50 border-red-800 text-red-300'
              : stage === 'done'
              ? 'bg-green-950/50 border-green-800 text-green-300'
              : 'bg-gray-800 border-gray-700 text-gray-300'}`}>

            {isWorking && (
              <div className="flex items-center gap-3 mb-2">
                {/* Animated progress bar */}
                <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full animate-pulse w-1/2" />
                </div>
              </div>
            )}

            <p>{stage === 'error' ? `❌ ${errorMsg}` : stage === 'done' ? `✅ ${statusMsg}` : `⏳ ${statusMsg}`}</p>

            {stage === 'error' && (
              <button onClick={reset} className="mt-2 text-xs text-red-400 hover:text-red-200 underline">
                Try again
              </button>
            )}
          </div>
        )}

        {/* ── Download button ───────────────────────────────────────────── */}
        {stage === 'done' && jobId && (
          <div className="space-y-3">
            <button
              onClick={handleDownload}
              className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-colors">
              ⬇️ Download Translated File
            </button>
            <button
              onClick={reset}
              className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
              Translate Another Document
            </button>
          </div>
        )}

        {/* ── Info box ──────────────────────────────────────────────────── */}
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-400">How it works</p>
          <p>① Your file is uploaded to Azure Blob Storage</p>
          <p>② Azure Document Translation processes it asynchronously</p>
          <p>③ The translated file is returned with original formatting preserved</p>
          <p className="pt-1 text-gray-600">Powered by Azure Cognitive Services · SAS tokens expire after 1 hour</p>
        </div>
      </div>
    </div>
  )
}
