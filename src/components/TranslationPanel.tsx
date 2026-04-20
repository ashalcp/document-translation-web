import AccuracyBadge from './AccuracyBadge'
import { OCRParagraph, TranslatedParagraph } from '../store/appStore'

interface Props {
  ocrParagraphs: OCRParagraph[]
  translatedParagraphs: TranslatedParagraph[]
  overallTranslationConfidence: number
  languageName: string
  currentPage?: number
}

export default function TranslationPanel({ ocrParagraphs, translatedParagraphs, overallTranslationConfidence, languageName, currentPage }: Props) {
  // Find which OCR paragraph IDs belong to current page
  const pageParaIds = currentPage
    ? new Set(ocrParagraphs.filter(p => p.pageNumber === currentPage).map(p => p.id))
    : null

  const filtered = pageParaIds
    ? translatedParagraphs.filter(p => pageParaIds.has(p.id))
    : translatedParagraphs

  return (
    <div className="flex flex-col h-full">
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700 flex-wrap gap-2">
        <h2 className="text-white font-semibold text-sm">
          {languageName} Translation {currentPage ? `— Page ${currentPage}` : ''}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs">Translation Accuracy</span>
          <AccuracyBadge value={overallTranslationConfidence} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filtered.length === 0 && (
          <p className="text-gray-500 text-sm text-center mt-8">No translation for this page.</p>
        )}
        {filtered.map(para => (
          <div key={para.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-purple-500 transition-colors">
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-gray-500 text-xs">Translated</span>
              <AccuracyBadge value={para.confidence} size="sm" />
            </div>
            <p className="text-gray-200 text-sm leading-relaxed">{para.translatedText}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
