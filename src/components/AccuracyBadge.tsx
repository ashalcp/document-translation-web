interface Props { value: number; size?: 'sm' | 'md' }

export default function AccuracyBadge({ value, size = 'md' }: Props) {
  const pct = Math.round(value * 100)
  const color = pct >= 90 ? 'text-green-400 bg-green-900/30 border-green-700'
    : pct >= 70 ? 'text-yellow-400 bg-yellow-900/30 border-yellow-700'
    : 'text-red-400 bg-red-900/30 border-red-700'
  const sz = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
  return (
    <span className={`border rounded font-mono font-semibold ${color} ${sz}`}>
      {pct}%
    </span>
  )
}
