import { useState } from 'react'
import AccuracyBadge from './AccuracyBadge'
import { OCRParagraph, TranslatedParagraph } from '../store/appStore'

interface Props {
  ocrParagraphs: OCRParagraph[]
  translatedParagraphs: TranslatedParagraph[]
  overallOCRConfidence: number
  overallTranslationConfidence: number
}

export default function TranslationPanel({ ocrParagraphs, translatedParagraphs, overallOCRConfidence, overallTranslationConfidence }: Props) {
  const [view, setView] = useState<'ocr' | 'translation'>('translation')
  const isTranslation = view === 'translation'
  const overallScore = isTranslation ? overallTranslationConfidence : overallOCRConfidence

  return (
    <div className="flex flex-col h-full">
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700 flex-wrap gap-2">
        <div className="flex bg-gray-700 rounded-lg p-0.5">
          <button onClick={() => setView('ocr')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${!isTranslation ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}>
            OCR
          </button>
          <button onClick={() => setView('translation')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${isTranslation ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}>
            Translation
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs">{isTranslation ? 'Translation Accuracy' : 'OCR Accuracy'}</span>
          <AccuracyBadge value={overallScore} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isTranslation
          ? translatedParagraphs.map(para => (
            <div key={para.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-purple-500 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-gray-500 text-xs">Translated</span>
                <AccuracyBadge value={para.confidence} size="sm" />
              </div>
              <p className="text-gray-200 text-sm leading-relaxed">{para.translatedText}</p>
            </div>
          ))
          : ocrParagraphs.map(para => (
            <div key={para.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-gray-500 text-xs">Page {para.pageNumber}</span>
                <AccuracyBadge value={para.confidence} size="sm" />
              </div>
              <p className="text-gray-200 text-sm leading-relaxed">{para.text}</p>
            </div>
          ))
        }
      </div>
    </div>
  )
}
