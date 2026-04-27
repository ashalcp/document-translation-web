import { useEffect, useState, Component, ReactNode } from 'react'
import { useAppStore } from './store/appStore'
import JobDetailView from './components/JobDetailView'
import SettingsModal from './components/SettingsModal'
import ProgressBar from './components/ProgressBar'
import LoginPage from './pages/LoginPage'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: any) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err: any) { return { error: err?.message ?? 'Unknown error' } }
  render() {
    if (this.state.error) return (
      <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <p className="text-red-400 font-semibold mb-2">{this.state.error}</p>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm mt-4"
          onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
    return this.props.children
  }
}

const STATUS_ICON: Record<string, string> = {
  'ocr-running': '🔄', 'ocr-done': '✅', 'translating': '🌐', 'done': '✨', 'error': '❌'
}

// Convert File to base64
const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

export default function App() {
  const { jobs, activeJobId, addJob, updateJob, setActiveJob, removeJob } = useAppStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loginError, setLoginError] = useState<string>()
  const [authChecked, setAuthChecked] = useState(false)
  const activeJob = jobs.find(j => j.id === activeJobId) ?? null

  // Check if auth is required on mount
  useEffect(() => {
    fetch('/api/auth/check', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.authRequired === false) {
          setIsAuthenticated(true)
        }
        setAuthChecked(true)
      })
      .catch(() => {
        setAuthChecked(true)
      })
  }, [])

  const handleLogin = async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      
      if (res.ok) {
        setIsAuthenticated(true)
        setLoginError(undefined)
      } else {
        setLoginError('Invalid username or password')
      }
    } catch (err) {
      setLoginError('Login failed. Please try again.')
    }
  }

  // Subscribe to SSE progress for all jobs
  useEffect(() => {
    if (!isAuthenticated) return
    const eventSources: Map<string, EventSource> = new Map()
    jobs.forEach(job => {
      if (eventSources.has(job.id)) return
      if (job.status === 'done' || job.status === 'error') return
      const es = new EventSource(`/api/progress/${job.id}`)
      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.type === 'ocr-progress') {
          useAppStore.getState().updateJob(job.id, { ocrProgress: (data.current / data.total) * 100 })
        } else if (data.type === 'translate-progress') {
          useAppStore.getState().updateJob(job.id, { translateProgress: (data.current / data.total) * 100 })
        }
      }
      eventSources.set(job.id, es)
    })
    return () => eventSources.forEach(es => es.close())
  }, [isAuthenticated, jobs.map(j => j.id).join(',')])

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    )
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} error={loginError} />
  }

  const handleFiles = async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(f => f.name.endsWith('.pdf'))
    for (const file of pdfs) {
      const base64 = await toBase64(file)
      const jobId = addJob(file.name, base64)

      // Upload for OCR
      const formData = new FormData()
      formData.append('file', file)
      formData.append('jobId', jobId)

      try {
        const res = await fetch('/api/ocr', { method: 'POST', credentials: 'include', body: formData })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error)
        }
        const result = await res.json()
        useAppStore.getState().updateJob(jobId, {
          status: 'ocr-done',
          ocrParagraphs: result.paragraphs,
          overallOCRConfidence: result.overallConfidence,
          pageCount: result.pageCount,
          originalPdfPath: result.originalPdfPath,
          searchablePdfPath: result.searchablePdfPath,
          ocrProgress: 100
        })
      } catch (e: any) {
        useAppStore.getState().updateJob(jobId, { status: 'error', error: e.message })
      }
    }
  }

  return (
    <div className="h-screen bg-gray-950 flex flex-col text-white overflow-hidden">
      <nav className="bg-gray-900 border-b border-gray-800 px-5 py-2 flex items-center justify-between flex-shrink-0">
        <span className="font-bold text-blue-400 text-lg">📝 DocTranslate</span>
        <button onClick={() => setSettingsOpen(true)}
          className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800">
          ⚙️ Settings
        </button>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-gray-800">
            <label
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            >
              + Add PDF
              <input type="file" accept=".pdf" multiple className="hidden"
                onChange={e => e.target.files && handleFiles(e.target.files)} />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {jobs.length === 0 && (
              <div className="text-gray-600 text-xs text-center mt-8 px-4">
                Drop a PDF or click<br />+ Add PDF to start
              </div>
            )}
            {jobs.map(job => (
              <div key={job.id} onClick={() => setActiveJob(job.id)}
                className={`rounded-lg p-3 cursor-pointer transition-colors ${job.id === activeJobId ? 'bg-gray-700 border border-gray-600' : 'hover:bg-gray-800 border border-transparent'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs">{STATUS_ICON[job.status]}</span>
                  <button onClick={e => { e.stopPropagation(); removeJob(job.id) }}
                    className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                </div>
                <p className="text-white text-xs font-medium truncate">{job.fileName}</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {job.status === 'ocr-running' ? 'OCR running...' :
                   job.status === 'ocr-done' ? 'Ready to translate' :
                   job.status === 'translating' ? 'Translating...' :
                   job.status === 'done' ? 'Done' : 'Error'}
                </p>
                {job.status === 'ocr-running' && <ProgressBar value={job.ocrProgress} label="" className="mt-2" />}
                {job.status === 'translating' && <ProgressBar value={job.translateProgress} label="" className="mt-2" />}
              </div>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-hidden flex flex-col"
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}>
          <ErrorBoundary>
            {activeJob ? (
              <JobDetailView key={activeJob.id} job={activeJob} />
            ) : (
              <div className={`flex-1 flex flex-col items-center justify-center p-10 transition-colors ${dragging ? 'bg-blue-900/10' : ''}`}>
                <div className="text-6xl mb-4">📄</div>
                <h1 className="text-2xl font-bold text-white mb-2">Document Translation App</h1>
                <p className="text-gray-400 mb-8 text-center max-w-md text-sm">
                  Upload one or more PDFs. OCR and translation run in parallel — add the next file while the first is still processing.
                </p>
                <label className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium cursor-pointer">
                  + Add PDF
                  <input type="file" accept=".pdf" multiple className="hidden"
                    onChange={e => e.target.files && handleFiles(e.target.files)} />
                </label>
                <p className="text-gray-600 text-xs mt-4">or drag & drop anywhere</p>
              </div>
            )}
          </ErrorBoundary>
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
