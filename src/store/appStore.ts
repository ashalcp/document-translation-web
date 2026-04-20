import { create } from 'zustand'

export interface OCRParagraph {
  id: string
  pageNumber: number
  text: string
  confidence: number
}

export interface TranslatedParagraph {
  id: string
  originalText: string
  translatedText: string
  confidence: number
}

export type JobStatus = 'ocr-running' | 'ocr-done' | 'translating' | 'done' | 'error'

export interface Job {
  id: string
  fileName: string
  fileData: string // base64 for PDF preview
  status: JobStatus
  ocrProgress: number
  ocrParagraphs: OCRParagraph[]
  overallOCRConfidence: number
  pageCount: number
  translatedParagraphs: TranslatedParagraph[]
  overallTranslationConfidence: number
  translateProgress: number
  selectedLanguage: string
  error: string | null
}

interface AppState {
  jobs: Job[]
  activeJobId: string | null
  addJob: (fileName: string, fileData: string) => string
  updateJob: (id: string, patch: Partial<Omit<Job, 'id'>>) => void
  setActiveJob: (id: string | null) => void
  removeJob: (id: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  jobs: [],
  activeJobId: null,

  addJob: (fileName, fileData) => {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const job: Job = {
      id, fileName, fileData,
      status: 'ocr-running',
      ocrProgress: 0,
      ocrParagraphs: [],
      overallOCRConfidence: 0,
      pageCount: 0,
      translatedParagraphs: [],
      overallTranslationConfidence: 0,
      translateProgress: 0,
      selectedLanguage: 'es',
      error: null
    }
    set(state => ({ jobs: [...state.jobs, job], activeJobId: id }))
    return id
  },

  updateJob: (id, patch) => {
    set(state => ({ jobs: state.jobs.map(j => j.id === id ? { ...j, ...patch } : j) }))
  },

  setActiveJob: (id) => set({ activeJobId: id }),

  removeJob: (id) => {
    set(state => {
      const jobs = state.jobs.filter(j => j.id !== id)
      const activeJobId = state.activeJobId === id
        ? (jobs[jobs.length - 1]?.id ?? null)
        : state.activeJobId
      return { jobs, activeJobId }
    })
  }
}))
