// ─── Public-surface theme presets ────────────────────────────────────────────
//
// THE PROBLEM THIS REPLACES. A studio's public surfaces (bio-link, website) each
// carried TWO independent controls: a light/dark/auto switch and a free
// background — a hex colour or a gradient. The two cross, and every crossing is
// a way to make an unreadable page:
//
//   • "Auto" + a fixed background is a contradiction. The text follows the
//     viewer's system preference and the background does not, so half the
//     audience reads dark grey on near-black. It was the DEFAULT pairing.
//   • "Light" + a dark custom background was patched over with a luminance
//     check that silently overrode the studio's own choice of theme — so the
//     switch did nothing, sometimes, and nothing said which times.
//   • Nothing anywhere expressed the thing a studio actually wants: "look right
//     in dark mode too."
//
// So a theme is now ONE choice with BOTH halves in it. A preset carries a light
// palette and a dark palette; whether a viewer sees one or the other is the
// preset's own business (`adaptive`), not a second setting. The studio picks a
// look and an accent colour, and the pair can never disagree.
//
// ── THE HOOKS FOR A FUTURE CUSTOM THEME ─────────────────────────────────────
// The registry below is closed on purpose for now — a handful of presets, no
// editor. Everything a per-studio custom theme needs is already in the shape:
// `SurfaceThemePreset` is a plain value with no reference to this file's list,
// and both resolvers (`resolveSurfacePalette` here, `buildPalette` in the web
// app) take a PRESET, not an id. Adding "create your own" later is a stored
// `SurfaceThemePreset` on the tenant plus a picker entry — the renderers do not
// change, and neither does anything stored today.
//
// ── STORAGE, AND WHY NOTHING MIGRATES ───────────────────────────────────────
// `Team.bioLinkThemePreset` / `SiteMeta.themePreset` hold an id. ABSENT means
// "this tenant predates presets", and the legacy `theme` + `background` fields
// still answer for it — the resolvers fall back to them. So no backfill, no
// deploy ordering, and a studio that had a look it liked keeps it until it picks
// a preset. Once it does, the preset wins and the legacy fields are ignored.

import { deriveCustomPreset } from './themeDerive'

/** Stable machine identifier. Stored in Firestore — a rename is a migration. */
export type SurfaceThemePresetId =
  | 'paper'
  | 'ink'
  | 'sand'
  | 'forest'
  | 'ocean'
  | 'rose'
  | 'violet'
  | 'slate'
  // DERIVED, not a member of SURFACE_THEME_PRESETS. Its palettes are computed
  // from the tenant's own colours — see `themeDerive.ts` and `resolveThemePreset`
  // below, which is the ONE place the two kinds meet.
  | 'custom'

/** One half of a preset: what the page looks like in one colour scheme. */
export interface SurfacePalette {
  /**
   * The page background. A plain hex, or any full CSS background value (a
   * gradient) — it is assigned to `background`, never to `background-color`.
   */
  background: string
  /**
   * Which text scheme sits on that background. Declared, never sniffed: a
   * luminance check cannot tell what a gradient reads like at the top of the
   * page, and it was the thing quietly overriding the studio's choice before.
   */
  scheme: 'light' | 'dark'
  /** The solid the header/nav bar and cards are tinted from. */
  surface: string
}

export interface SurfaceThemePreset {
  id: SurfaceThemePresetId
  /** Key in the `Themes` i18n namespace. Keys, not strings: this module is
   *  shared with Cloud Functions and must hold no English. */
  nameKey: string
  light: SurfacePalette
  dark: SurfacePalette
  /** The accent a studio gets before it picks one. Always overridable. */
  defaultAccent: string
  /**
   * Does the preset follow the viewer's system colour scheme?
   *
   * True for the neutral pairs. FALSE for a preset that IS a look — `ink` is
   * dark on purpose, and swapping it to parchment for a viewer in light mode
   * would be a different design, not the same one adapted. A fixed preset uses
   * its `light`/`dark` entry per `fixedScheme` in both modes.
   */
  adaptive: boolean
  /** Which half a non-adaptive preset always uses. Ignored when adaptive. */
  fixedScheme?: 'light' | 'dark'
}

/**
 * The presets, in picker order. Neutral first: most studios want their own
 * colour to be the only colour, and the accent is what carries it.
 */
export const SURFACE_THEME_PRESETS: readonly SurfaceThemePreset[] = [
  {
    // The default, and the neutral one — a studio whose colour is its accent.
    // `mono` used to sit beside this with the same near-white light half; it was
    // a second name for one look, so it is gone (Franco, 2026-09-03).
    id: 'paper',
    nameKey: 'paper',
    light: { background: '#ffffff', scheme: 'dark', surface: '#f4f5f7' },
    dark: { background: '#0b0d12', scheme: 'light', surface: '#161922' },
    defaultAccent: '#6366f1',
    adaptive: true,
  },
  {
    // Dark by choice, in both modes — the look a lot of gyms and clubs want.
    id: 'ink',
    nameKey: 'ink',
    light: { background: '#0f1115', scheme: 'light', surface: '#191d25' },
    dark: { background: '#0f1115', scheme: 'light', surface: '#191d25' },
    defaultAccent: '#f59e0b',
    adaptive: false,
    fixedScheme: 'dark',
  },
  {
    // Every pair below is ONE HUE: the dark half is the light half taken much
    // darker, so the two versions read as the same theme at two times of day.
    id: 'sand',
    nameKey: 'sand',
    light: { background: '#faf5ec', scheme: 'dark', surface: '#f1e7d6' },
    dark: { background: '#171310', scheme: 'light', surface: '#241d17' },
    defaultAccent: '#b45309',
    adaptive: true,
  },
  {
    id: 'forest',
    nameKey: 'forest',
    light: { background: '#f0f7f2', scheme: 'dark', surface: '#e0efe4' },
    dark: { background: '#0b1410', scheme: 'light', surface: '#14211a' },
    defaultAccent: '#15803d',
    adaptive: true,
  },
  {
    id: 'ocean',
    nameKey: 'ocean',
    light: { background: '#eef6fc', scheme: 'dark', surface: '#dcecf7' },
    dark: { background: '#08131d', scheme: 'light', surface: '#101f2b' },
    defaultAccent: '#0369a1',
    adaptive: true,
  },
  {
    id: 'rose',
    nameKey: 'rose',
    light: { background: '#fdf2f6', scheme: 'dark', surface: '#f9e2ec' },
    dark: { background: '#180f14', scheme: 'light', surface: '#26161e' },
    defaultAccent: '#e11d76',
    adaptive: true,
  },
  {
    id: 'violet',
    nameKey: 'violet',
    light: { background: '#f5f3ff', scheme: 'dark', surface: '#eae6fd' },
    dark: { background: '#130f1f', scheme: 'light', surface: '#1f1930' },
    defaultAccent: '#7c3aed',
    adaptive: true,
  },
  {
    id: 'slate',
    nameKey: 'slate',
    light: { background: '#f5f7fa', scheme: 'dark', surface: '#e7ecf2' },
    dark: { background: '#0d1117', scheme: 'light', surface: '#171d27' },
    defaultAccent: '#475569',
    adaptive: true,
  },
]

export const DEFAULT_SURFACE_THEME_PRESET_ID: SurfaceThemePresetId = 'paper'

/** Look up a preset by id. Unknown/absent ids resolve to null rather than to the
 *  default, so a caller can tell "not chosen" from "chose this". */
export function surfaceThemePreset(
  id: string | null | undefined
): SurfaceThemePreset | null {
  if (!id) return null
  return SURFACE_THEME_PRESETS.find((p) => p.id === id) ?? null
}

/** What a tenant stored about its theme. The fields travel together because
 *  they are one choice — see `resolveThemePreset`. */
export interface ThemeSelection {
  presetId?: string | null
  /** Custom: the light-page colour (and the whole site when `single`). */
  light?: string | null
  /** Custom: the dark-page colour. Absent ⇒ a correlate of `light`. */
  dark?: string | null
  /** Custom: one colour, one look for everyone. */
  single?: boolean | null
  /** Custom: a soft gradient instead of a flat background. */
  lighting?: boolean | null
}

/**
 * THE ONE PLACE A STORED THEME BECOMES A PRESET.
 *
 * Both kinds resolve here: a registry id looks up, `'custom'` derives. Every
 * renderer calls this rather than `surfaceThemePreset`, so there is no surface
 * where a custom theme could be handled differently from a fixed one — the
 * failure this whole module exists to prevent, one level up.
 *
 * Returns null for "nothing chosen", exactly as `surfaceThemePreset` does, so
 * the legacy `theme` + `background` fallback in each renderer is reached the
 * same way it was before custom themes existed. A `'custom'` selection whose
 * base will not parse ALSO returns null: falling back to the studio's previous
 * look is honest, where falling back to `paper` would silently redesign the page.
 */
export function resolveThemePreset(sel: ThemeSelection): SurfaceThemePreset | null {
  if (sel.presetId === 'custom') {
    if (!sel.light) return null
    return deriveCustomPreset({
      light: sel.light,
      dark: sel.dark,
      single: !!sel.single,
      lighting: !!sel.lighting,
    })
  }
  return surfaceThemePreset(sel.presetId)
}

/**
 * Which half of a preset a viewer sees.
 *
 * `systemDark` is the viewer's `prefers-color-scheme`. A non-adaptive preset
 * ignores it entirely — that is the whole difference between "a theme that
 * adapts" and "a theme that is dark".
 */
export function resolveSurfacePalette(
  preset: SurfaceThemePreset,
  systemDark: boolean
): SurfacePalette {
  if (!preset.adaptive) return preset.fixedScheme === 'light' ? preset.light : preset.dark
  return systemDark ? preset.dark : preset.light
}
