'use client'

/**
 * A LIVE MINIATURE of a theme — a background, a heading, a line of text, a muted
 * line and a button — shown for the light and the dark version side by side (or
 * one, for a single-look theme).
 *
 * It is NOT a copy of any real website component, on purpose: a studio changing
 * colours wants to see the COLOURS decide something, quickly, without the
 * preview pretending to be their actual page. So it is a small, honest mock that
 * exercises every role a palette fills — page, surface, text, muted, accent —
 * and nothing else (Franco, 2026-09-03).
 *
 * The text colours are the SAME ones the site renderer uses (`inkFor` in
 * `components/site/theme.ts`), so what the preview promises is what ships.
 */

import type { SurfacePalette } from '@linyup/shared'
import { useTranslations } from 'next-intl'

/** Mirrors `inkFor` in the site renderer — scheme 'dark' means dark text. */
function ink(scheme: 'light' | 'dark') {
  return scheme === 'light'
    ? { text: '#f8fafc', muted: 'rgba(248,250,252,0.62)', border: 'rgba(255,255,255,0.12)' }
    : { text: '#0f172a', muted: '#64748b', border: 'rgba(15,23,42,0.08)' }
}

function PreviewCard({
  palette,
  accent,
  label,
}: {
  palette: SurfacePalette
  accent: string
  label: string
}) {
  const k = ink(palette.scheme)
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: k.border }}>
      {/* the page */}
      <div style={{ background: palette.background }}>
        {/* a header bar, from the surface — the one place the surface shows */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ background: palette.surface, borderBottom: `1px solid ${k.border}` }}
        >
          <span className="text-[11px] font-semibold" style={{ color: k.text }}>
            {label}
          </span>
          <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        </div>
        <div className="space-y-2 px-3 py-3">
          <div className="text-sm font-bold leading-tight" style={{ color: k.text }}>
            Aa
          </div>
          <div className="h-1.5 w-full rounded-full" style={{ background: k.text, opacity: 0.8 }} />
          <div className="h-1.5 w-2/3 rounded-full" style={{ background: k.muted }} />
          <span
            className="mt-1 inline-block rounded-md px-2.5 py-1 text-[10px] font-medium"
            style={{ background: accent, color: '#ffffff' }}
          >
            Button
          </span>
        </div>
      </div>
    </div>
  )
}

export function ThemePreview({
  light,
  dark,
  accent,
  adaptive,
}: {
  light: SurfacePalette
  dark: SurfacePalette
  accent: string
  /** One card for a single-look theme; two stacked for an adaptive one. */
  adaptive: boolean
}) {
  const t = useTranslations('Themes')
  return (
    <div className="space-y-2">
      <PreviewCard palette={light} accent={accent} label={t('previewLight')} />
      {adaptive && <PreviewCard palette={dark} accent={accent} label={t('previewDark')} />}
    </div>
  )
}
