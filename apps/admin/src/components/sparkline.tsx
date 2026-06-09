import { cn } from '@/lib/utils'

// Dependency-free SVG sparkline (keeps the admin bundle lean — no chart lib).
export function Sparkline({
  values,
  className,
  width = 240,
  height = 48,
}: {
  values: number[]
  className?: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 3
  const stepX = (width - pad * 2) / (values.length - 1)

  const points = values.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (height - pad * 2) * (1 - (v - min) / span)
    return [x, y] as const
  })

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lastX, lastY] = points[points.length - 1]!

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-12 w-full overflow-visible', className)}
      preserveAspectRatio="none"
      role="img"
    >
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.5} fill="var(--primary)" />
    </svg>
  )
}
