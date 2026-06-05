import { useId } from 'react'

interface LogoProps {
  size?: number
  mark?: boolean
  dark?: boolean
  className?: string
}

export function Logo({ size = 28, mark = true, dark = false, className }: LogoProps) {
  const gid = useId()
  const fg = dark ? '#ffffff' : 'var(--color-foreground, var(--foreground))'
  const acc = dark ? '#c4b5fd' : 'var(--color-primary, var(--primary))'
  const markSize = Math.round(size * 1.05)

  return (
    <span
      className={`inline-flex items-center gap-[0.32em] ${className ?? ''}`}
      style={{ lineHeight: 1 }}
    >
      {mark && (
        <svg
          width={markSize}
          height={markSize}
          viewBox="0 0 100 100"
          aria-hidden="true"
          style={{ display: 'block', overflow: 'visible', flexShrink: 0 }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#5b21b6" />
            </linearGradient>
          </defs>
          <path
            d="M16 82 Q42 80 58 52 T86 16"
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth="14"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span
        style={{
          fontFamily: "var(--font-fredoka, 'Fredoka', sans-serif)",
          fontSize: size,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: fg }}>liny</span>
        <span style={{ color: acc }}>up</span>
      </span>
    </span>
  )
}
