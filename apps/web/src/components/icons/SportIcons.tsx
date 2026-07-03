import type { SVGProps } from 'react'

// Small line icons in the lucide style (24×24, currentColor stroke) for sports
// lucide doesn't ship. Sized via className (e.g. `size-5`) like lucide icons.
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function BoxingGlove(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...base} {...props}>
      {/* mitt */}
      <path d="M7 7a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4v3a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5V9a2 2 0 0 1 2-2Z" />
      {/* finger seam */}
      <path d="M9 3v3" />
      {/* wrist cuff */}
      <path d="M8.5 16v2a3 3 0 0 0 6 0v-2" />
    </svg>
  )
}

export function TennisRacket(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...base} {...props}>
      {/* head + strings */}
      <circle cx="9" cy="9" r="6" />
      <path d="M6 8h6M6 10h6M8 6v6M10 6v6" />
      {/* shaft + grip */}
      <path d="m13.2 13.2 5 5" />
      <path d="m14.6 15 3.4 3.4-1.6 1.6-3.4-3.4z" />
    </svg>
  )
}
