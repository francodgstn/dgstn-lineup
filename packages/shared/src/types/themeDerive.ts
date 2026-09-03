// ─── A theme derived from the studio's own colour ────────────────────────────
//
// WHAT THE REGISTRY COULD NOT SAY. `SURFACE_THEME_PRESETS` is six fixed looks,
// and read together they have a shape a studio noticed before we did: the light
// halves are all near-white and the dark halves are all near-black, so the only
// thing that really varies between them is a faint tint (Franco, 2026-09-03).
// A studio whose brand is deep green cannot get a deep green site; it can get a
// white site with a green accent, six ways.
//
// So this derives a preset from ONE colour instead of choosing between six. The
// base is NOT the accent — that separation is the point. The accent is what
// stands out (a button, a link); the base is what everything else is made of.
// A studio that sets both gets a page built from its brand with a second colour
// for the things that must be noticed; a studio that sets only a base gets a
// coherent page with an accent derived from it.
//
// ── WHY DERIVED AND NOT STORED ──────────────────────────────────────────────
// The palettes are computed at read time from `{base, variant}` rather than
// frozen into Firestore. One source of truth, so a fix to the ramp reaches every
// tenant, and a studio's stored intent stays "our green" rather than eleven hex
// values that no longer mean anything if the ramp changes. The cost is that
// improving the ramp shifts existing pages — which is why the variants below are
// coarse and named for INTENT ('soft', 'tinted', 'deep') rather than for numbers
// nobody promised to keep.
//
// ── THE ONE THING THAT IS NOT NEGOTIABLE ────────────────────────────────────
// A derived palette declares its `scheme` like every other palette, and the
// derivation guarantees the contrast that declaration claims: the light half is
// always light enough for dark text, the dark half always dark enough for light
// text, whatever hue and saturation the studio picked. `clampL` is where that
// is enforced, and it is why a studio cannot produce an unreadable page by
// picking a mid-grey — the very failure the preset system was built to remove.

import type { SurfacePalette, SurfaceThemePreset } from './themePreset'

/**
 * How much of the base colour reaches the page.
 *
 * Named for intent rather than for the numbers, because the numbers are allowed
 * to improve and the intent is what a studio chose. Order is picker order.
 */
export type ThemeVariantId = 'soft' | 'tinted' | 'deep'

export const THEME_VARIANTS: readonly { id: ThemeVariantId; nameKey: string }[] = [
  // Barely there — the base is a hint, closest to the fixed presets.
  { id: 'soft', nameKey: 'variantSoft' },
  // Clearly the studio's colour, still calm enough to read a page on.
  { id: 'tinted', nameKey: 'variantTinted' },
  // The dark half stops being near-black and becomes the colour. This is the
  // one the fixed presets could not express at all.
  { id: 'deep', nameKey: 'variantDeep' },
]

export const DEFAULT_THEME_VARIANT: ThemeVariantId = 'tinted'

/**
 * Whether the theme has two halves at all.
 *
 * 'adaptive' derives a light page AND a dark page from the base, and the viewer
 * gets whichever matches their device. That is the default and what most
 * studios want.
 *
 * 'exact' uses the colour AS IT IS: the page background IS the base, and the
 * site is that one look for everyone. It exists because a studio that picked a
 * deep navy or a warm cream did not pick "a hint of navy in a white page" — and
 * under 'adaptive' that is what they got, because every derived light half is
 * pushed up to near-white by construction (Franco, 2026-09-03).
 *
 * The text scheme is decided by the colour's own lightness, so a dark base
 * gives a dark site and a light base a light one. There is nothing to choose
 * and nothing to get wrong.
 */
export type ThemeMode = 'adaptive' | 'exact'

export const DEFAULT_THEME_MODE: ThemeMode = 'adaptive'

/**
 * THE UNREADABLE MIDDLE, and the one place 'exact' is not exact.
 *
 * A background between these is too dark for dark text and too light for light
 * text — no scheme reads on it. Rather than render a page nobody can use, a
 * base that lands in the band is pushed to the nearer edge: the studio still
 * gets its hue, at the closest lightness that carries type.
 *
 * Everything outside the band is used verbatim, which is every colour a studio
 * would actually choose as a page.
 */
const UNREADABLE_MIN = 42
const UNREADABLE_MAX = 62

// ── colour maths ────────────────────────────────────────────────────────────
// Small and local on purpose: this is the only place in the codebase that needs
// HSL, and a dependency for forty lines is a dependency to keep updated.

interface Hsl {
  h: number
  s: number
  l: number
}

/** `#rgb` or `#rrggbb` → HSL. Returns null for anything else, so a caller can
 *  fall back rather than render from a colour that was never parsed. */
export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hue: number
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) hue = ((b - r) / d + 2) / 6
  else hue = ((r - g) / d + 4) / 6
  return { h: hue * 360, s: s * 100, l: l * 100 }
}

function hslToHex({ h, s, l }: Hsl): string {
  const sN = Math.min(100, Math.max(0, s)) / 100
  const lN = Math.min(100, Math.max(0, l)) / 100
  const c = (1 - Math.abs(2 * lN - 1)) * sN
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]
  const m = lN - c / 2
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r1)}${to(g1)}${to(b1)}`
}

/** THE CONTRAST GUARANTEE. A palette that declares `scheme: 'dark'` (dark text)
 *  must be light enough to carry it, and vice versa — whatever the studio
 *  picked. Nothing else in this file may widen these bounds. */
function clampL(l: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, l))
}

interface Ramp {
  /** Lightness of the light half's page background / its surface. */
  lightBg: number
  lightSurface: number
  /** Lightness of the dark half's page background / its surface. */
  darkBg: number
  darkSurface: number
  /** How much of the base's saturation survives into each half. */
  lightSat: number
  darkSat: number
}

const RAMPS: Record<ThemeVariantId, Ramp> = {
  // Near-white and near-black, a breath of hue. Roughly where the fixed presets
  // already were, kept so "custom" is not a jump.
  soft: { lightBg: 98, lightSurface: 95, darkBg: 9, darkSurface: 14, lightSat: 30, darkSat: 22 },
  // The default. The colour is legible on both halves without competing with
  // page content.
  tinted: { lightBg: 96, lightSurface: 91, darkBg: 12, darkSurface: 18, lightSat: 55, darkSat: 40 },
  // The dark half becomes the colour rather than a tinted black — deep navy,
  // forest, plum. THE reason this module exists.
  deep: { lightBg: 93, lightSurface: 87, darkBg: 17, darkSurface: 24, lightSat: 80, darkSat: 65 },
}

/** Bounds, not preferences. See `clampL`. */
const LIGHT_MIN = 88
const LIGHT_MAX = 99
const DARK_MIN = 6
const DARK_MAX = 26

/**
 * How strongly the colour comes through, chosen PER HALF.
 *
 * One strength for both was the first cut and it could not express the thing
 * studios actually want: a light half that stays quiet in daylight and a dark
 * half that is properly the colour at night (Franco, 2026-09-03). They are two
 * different rooms, and a studio judges them separately.
 *
 * A bare `ThemeVariantId` is still accepted and means "the same in both", which
 * is what every caller that does not care should pass.
 */
export interface ThemeVariants {
  light: ThemeVariantId
  dark: ThemeVariantId
}

export function normalizeVariants(
  v: ThemeVariantId | ThemeVariants | null | undefined
): ThemeVariants {
  if (!v) return { light: DEFAULT_THEME_VARIANT, dark: DEFAULT_THEME_VARIANT }
  if (typeof v === 'string') return { light: v, dark: v }
  return {
    light: v.light ?? DEFAULT_THEME_VARIANT,
    dark: v.dark ?? DEFAULT_THEME_VARIANT,
  }
}

/**
 * Build a preset from a studio's own colour.
 *
 * `baseDark` is optional and is the "two colours, one light one dark" case: a
 * studio whose brand has a separate dark tone gives it here and the dark half
 * is built from that hue instead. Absent, both halves come from `base`, which
 * is the common case and the one the picker leads with.
 *
 * Returns null for an unparseable base so the caller can fall back to a fixed
 * preset rather than render from nothing.
 */
export function deriveThemePreset(
  base: string,
  variant: ThemeVariantId | ThemeVariants = DEFAULT_THEME_VARIANT,
  baseDark?: string | null,
  mode: ThemeMode = DEFAULT_THEME_MODE
): SurfaceThemePreset | null {
  const hsl = hexToHsl(base)
  if (!hsl) return null
  const darkHsl = (baseDark ? hexToHsl(baseDark) : null) ?? hsl

  if (mode === 'exact') {
    // The colour AS IT IS, nudged out of the unreadable band and no further.
    const l =
      hsl.l > UNREADABLE_MIN && hsl.l < UNREADABLE_MAX
        ? hsl.l - UNREADABLE_MIN < UNREADABLE_MAX - hsl.l
          ? UNREADABLE_MIN
          : UNREADABLE_MAX
        : hsl.l
    const isLightPage = l >= UNREADABLE_MAX
    const background = hslToHex({ ...hsl, l })
    // The surface steps AWAY from the page — lighter on a dark page, darker on
    // a light one — so cards and the header bar separate from it either way.
    const surface = hslToHex({ ...hsl, l: isLightPage ? Math.max(0, l - 5) : Math.min(100, l + 7) })
    const palette: SurfacePalette = {
      background,
      surface,
      // 'dark' means DARK TEXT. A light page takes dark text and vice versa.
      scheme: isLightPage ? 'dark' : 'light',
    }
    return {
      id: 'custom',
      nameKey: 'custom',
      // BOTH HALVES ARE THE SAME PALETTE, and `adaptive: false` is what makes
      // that a promise rather than a coincidence: the renderer never asks the
      // viewer's device, and the visitor scheme toggle refuses to render.
      light: palette,
      dark: palette,
      defaultAccent: hslToHex({
        h: hsl.h,
        s: Math.max(hsl.s, 45),
        // Away from the page, so the accent is visible on it.
        l: isLightPage ? 38 : 66,
      }),
      adaptive: false,
      fixedScheme: isLightPage ? 'light' : 'dark',
    }
  }

  const v = normalizeVariants(variant)
  // ONE RAMP PER HALF. Each half reads only its own, so the two can differ
  // freely — and passing a single id keeps them identical, which is the old
  // behaviour exactly.
  const lightRamp = RAMPS[v.light] ?? RAMPS[DEFAULT_THEME_VARIANT]
  const darkRamp = RAMPS[v.dark] ?? RAMPS[DEFAULT_THEME_VARIANT]

  // A near-grey base has no hue worth carrying, so scaling its saturation would
  // produce a colour cast from rounding rather than from a choice. Below this it
  // stays neutral and the studio gets a clean monochrome page.
  const sat = (source: number, pct: number) => (source < 6 ? 0 : (source * pct) / 100)

  const light: SurfacePalette = {
    background: hslToHex({ h: hsl.h, s: sat(hsl.s, lightRamp.lightSat), l: clampL(lightRamp.lightBg, LIGHT_MIN, LIGHT_MAX) }),
    surface: hslToHex({ h: hsl.h, s: sat(hsl.s, lightRamp.lightSat), l: clampL(lightRamp.lightSurface, LIGHT_MIN, LIGHT_MAX) }),
    // 'dark' means DARK TEXT on this background — see SurfacePalette.
    scheme: 'dark',
  }
  const dark: SurfacePalette = {
    background: hslToHex({ h: darkHsl.h, s: sat(darkHsl.s, darkRamp.darkSat), l: clampL(darkRamp.darkBg, DARK_MIN, DARK_MAX) }),
    surface: hslToHex({ h: darkHsl.h, s: sat(darkHsl.s, darkRamp.darkSat), l: clampL(darkRamp.darkSurface, DARK_MIN, DARK_MAX) }),
    scheme: 'light',
  }

  return {
    id: 'custom',
    nameKey: 'custom',
    light,
    dark,
    // The accent a studio gets BEFORE it picks one: the base at full strength,
    // pulled to a lightness that works as a button colour under either half.
    defaultAccent: hslToHex({ h: hsl.h, s: Math.max(hsl.s, 45), l: clampL(hsl.l, 38, 58) }),
    // Always adaptive. A derived theme has two real halves by construction, so
    // there is nothing for a `fixedScheme` to choose between — and a studio that
    // wants one look picks a fixed preset instead.
    adaptive: true,
  }
}
