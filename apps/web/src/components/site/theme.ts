import type { SiteMeta, SiteCta, SiteFont } from '@linyup/shared'
import { DEFAULT_ACCENT } from '@/lib/colors'
import { publicHrefLocalized } from '@/lib/publicRoutes'

// Shared theming for the Website plugin renderer (public site + builder preview).

export interface SitePalette {
  isDark: boolean
  bg: string
  // Translucent header/nav background — always a valid solid+alpha (never the
  // custom page background, which may be a gradient that can't take an alpha).
  headerBg: string
  surface: string
  border: string
  text: string
  muted: string
  accent: string
  onAccent: string
}

export function buildPalette(
  meta: { theme: SiteMeta['theme']; accentColor?: string; background?: string },
  systemDark: boolean
): SitePalette {
  const isDark = meta.theme === 'dark' || (meta.theme === 'auto' && systemDark)
  const accent = meta.accentColor || DEFAULT_ACCENT
  const base = isDark
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
  // Header floats as a translucent version of the THEME solid; the page bg may
  // be a custom color/gradient underneath it.
  return { ...base, headerBg: `${base.bg}d9`, bg: meta.background || base.bg }
}

export const FONT_STACK: Record<SiteFont, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"ui-rounded", "SF Pro Rounded", "Nunito", "Quicksand", system-ui, sans-serif',
}

/**
 * Resolve a CTA to an href. booking/signup → the team's public flows; url → external.
 *
 * Locale-prefixed, because the site renders these as raw `<a href>` (see
 * `RenderCtx.locale`). `from: 'site'` gives the flow a back link to the website
 * the visitor is standing on, rather than the team's default landing surface.
 */
export function ctaHref(
  cta: Pick<SiteCta, 'action' | 'url'> | undefined,
  slug: string,
  locale: string
): string | undefined {
  if (!cta) return undefined
  if (cta.action === 'booking') return publicHrefLocalized(locale, slug, 'booking', { from: 'site' })
  // 'signup' is current; 'membership' is the legacy stored alias.
  if (cta.action === 'signup' || (cta.action as string) === 'membership')
    return publicHrefLocalized(locale, slug, 'signup', { from: 'site' })
  return cta.url || undefined
}
