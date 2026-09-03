import { resolveSurfacePalette, resolveThemePreset } from '@linyup/shared'
import type { SiteMeta, SiteCta, SiteFont, SurfaceThemePresetId } from '@linyup/shared'
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

/** The ink and lines that sit on a background of a given scheme. Shared by both
 *  the preset path and the legacy one, so a preset can never render text the
 *  legacy theme would have rendered differently. */
function inkFor(scheme: 'light' | 'dark', accent: string) {
  return scheme === 'light'
    ? {
        isDark: true,
        accent,
        onAccent: '#ffffff',
        border: 'rgba(255,255,255,0.12)',
        text: '#f8fafc',
        muted: 'rgba(248,250,252,0.62)',
      }
    : {
        isDark: false,
        accent,
        onAccent: '#ffffff',
        border: 'rgba(15,23,42,0.08)',
        text: '#0f172a',
        muted: '#64748b',
      }
}

/**
 * THE ONE palette resolver for the website renderer — preset first, legacy
 * theme+background second.
 *
 * `themePreset` carries BOTH schemes, so `systemDark` picks a half rather than
 * fighting a separately-chosen background (see types/themePreset.ts for the
 * crossings this removed). While it is absent the old path runs unchanged, which
 * is what lets presets ship with no backfill.
 *
 * The `headerBg` rule is the same in both: the bar is a translucent version of
 * the SOLID, never of the page background, which may be a gradient that cannot
 * take an alpha suffix.
 */
export function buildPalette(
  meta: {
    theme: SiteMeta['theme']
    accentColor?: string
    background?: string
    themePreset?: SurfaceThemePresetId | null
    // Read only for a 'custom' preset — see resolveThemePreset, which is the one
    // place a stored theme becomes a palette whichever kind it is.
    themeBase?: string | null
    themeBaseDark?: string | null
    themeVariantLight?: string | null
    themeVariantDark?: string | null
    themeMode?: string | null
  },
  systemDark: boolean
): SitePalette {
  const preset = resolveThemePreset({
    presetId: meta.themePreset,
    base: meta.themeBase,
    baseDark: meta.themeBaseDark,
    variantLight: meta.themeVariantLight,
    variantDark: meta.themeVariantDark,
    mode: meta.themeMode,
  })
  if (preset) {
    const surfacePalette = resolveSurfacePalette(preset, systemDark)
    const accent = meta.accentColor || preset.defaultAccent
    const base = inkFor(surfacePalette.scheme, accent)
    return {
      ...base,
      surface: surfacePalette.surface,
      headerBg: `${surfacePalette.surface}d9`,
      bg: surfacePalette.background,
    }
  }

  const isDark = meta.theme === 'dark' || (meta.theme === 'auto' && systemDark)
  const accent = meta.accentColor || DEFAULT_ACCENT
  const solid = isDark ? '#0b0f19' : '#ffffff'
  const base = {
    ...inkFor(isDark ? 'light' : 'dark', accent),
    surface: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc',
  }
  return { ...base, headerBg: `${solid}d9`, bg: meta.background || solid }
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
