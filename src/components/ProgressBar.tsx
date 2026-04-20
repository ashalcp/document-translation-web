interface Props { value: number; label?: string; className?: string }

export default function ProgressBar({ value, label, className = '' }: Props) {
  return (
    <div className={`w-full ${className}`}>
      {label && <p className="text-xs text-gray-400 mb-1">{label}</p>}
      <div className="w-full bg-gray-700 rounded-full h-2.5">
        <div className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-1 text-right">{Math.round(value)}%</p>
    </div>
  )
}
