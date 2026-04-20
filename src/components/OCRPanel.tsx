import AccuracyBadge from './AccuracyBadge'
import { OCRParagraph } from '../store/appStore'

interface Props { paragraphs: OCRParagraph[]; overallConfidence: number }

export default function OCRPanel({ paragraphs, overallConfidence }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <h2 className="text-white font-semibold text-sm">OCR Result</h2>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs">Overall Accuracy</span>
          <AccuracyBadge value={overallConfidence} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {paragraphs.map(para => (
          <div key={para.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-blue-500 transition-colors">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-gray-500 text-xs">Page {para.pageNumber}</span>
              <AccuracyBadge value={para.confidence} size="sm" />
            </div>
            <p className="text-gray-200 text-sm leading-relaxed">{para.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
