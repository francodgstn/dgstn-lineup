import type { SiteMeta, SiteCta, SiteFont } from '@linyup/shared'

// Shared theming for the Website plugin renderer (public site + builder preview).

export interface SitePalette {
  isDark: boolean
  bg: string
  surface: string
  border: string
  text: string
  muted: string
  accent: string
  onAccent: string
}

export function buildPalette(meta: SiteMeta, systemDark: boolean): SitePalette {
  const isDark = meta.theme === 'dark' || (meta.theme === 'auto' && systemDark)
  const accent = meta.accentColor || '#6366f1'
  return isDark
    ? {
        isDark,
        accent,
        onAccent: '#ffffff',
        bg: '#0b0f19',
        surface: 'rgba(255,255,255,0.05)',
        border: 'rgba(255,255,255,0.12)',
        text: '#f8fafc',
        muted: 'rgba(248,250,252,0.62)',
      }
    : {
        isDark,
        accent,
        onAccent: '#ffffff',
        bg: '#ffffff',
        surface: '#f8fafc',
        border: 'rgba(15,23,42,0.08)',
        text: '#0f172a',
        muted: '#64748b',
      }
}

export const FONT_STACK: Record<SiteFont, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"ui-rounded", "SF Pro Rounded", "Nunito", "Quicksand", system-ui, sans-serif',
}

/** Resolve a CTA to an href. booking/membership → bio-link flows; url → external. */
export function ctaHref(
  cta: Pick<SiteCta, 'action' | 'url'> | undefined,
  slug: string
): string | undefined {
  if (!cta) return undefined
  if (cta.action === 'booking') return `/public/bio-link/${slug}/booking`
  if (cta.action === 'membership') return `/public/bio-link/${slug}/signup`
  return cta.url || undefined
}
