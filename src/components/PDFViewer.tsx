import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href

interface Props { fileData: string } // base64 PDF

export default function PDFViewer({ fileData }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pdfRef = useRef<any>(null)
  const renderTaskRef = useRef<any>(null)
  const isInitialLoad = useRef(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    isInitialLoad.current = true

    const binary = atob(fileData)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    pdfjsLib.getDocument({ data: bytes }).promise
      .then((pdf: any) => {
        pdfRef.current = pdf
        setTotalPages(pdf.numPages)
        setPage(1)
        setLoading(false)
        renderPage(pdf, 1)
      })
      .catch((err: any) => {
        setError(err?.message ?? 'Failed to load PDF')
        setLoading(false)
      })
  }, [fileData])

  useEffect(() => {
    if (isInitialLoad.current) { isInitialLoad.current = false; return }
    if (pdfRef.current) renderPage(pdfRef.current, page)
  }, [page])

  const renderPage = async (pdf: any, pageNum: number) => {
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch {}
      renderTaskRef.current = null
    }
    try {
      const p = await pdf.getPage(pageNum)
      const viewport = p.getViewport({ scale: 1.2 })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      const task = p.render({ canvasContext: canvas.getContext('2d')!, viewport })
      renderTaskRef.current = task
      await task.promise
      renderTaskRef.current = null
    } catch (err: any) {
      if (err?.name === 'RenderingCancelledException') return
      setError(err?.message ?? 'Failed to render page')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between bg-gray-800 px-3 py-2 text-sm text-white">
        <button className="px-2 py-1 bg-gray-700 rounded disabled:opacity-40"
          disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>◀</button>
        <span>{loading ? 'Loading...' : `Page ${page} / ${totalPages}`}</span>
        <button className="px-2 py-1 bg-gray-700 rounded disabled:opacity-40"
          disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)}>▶</button>
      </div>
      <div className="flex-1 overflow-auto bg-gray-900 flex justify-center items-center p-2">
        {error ? (
          <div className="text-red-400 text-sm text-center">⚠️ {error}</div>
        ) : loading ? (
          <div className="flex flex-col items-center text-gray-500">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Loading PDF...</p>
          </div>
        ) : (
          <canvas ref={canvasRef} className="shadow-lg" />
        )}
      </div>
    </div>
  )
}
