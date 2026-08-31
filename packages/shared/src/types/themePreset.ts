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

/** Stable machine identifier. Stored in Firestore — a rename is a migration. */
export type SurfaceThemePresetId =
  | 'paper'
  | 'ink'
  | 'sand'
  | 'forest'
  | 'ocean'
  | 'mono'

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
    // The default look, and the one that answers "make it work in dark mode".
    id: 'paper',
    nameKey: 'paper',
    light: { background: '#ffffff', scheme: 'dark', surface: '#f8fafc' },
    dark: { background: '#0b0f19', scheme: 'light', surface: '#151b2b' },
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
    id: 'sand',
    nameKey: 'sand',
    light: { background: '#faf6f0', scheme: 'dark', surface: '#f2eadf' },
    dark: { background: '#1b1712', scheme: 'light', surface: '#26201a' },
    defaultAccent: '#b45309',
    adaptive: true,
  },
  {
    id: 'forest',
    nameKey: 'forest',
    light: { background: '#f3f8f4', scheme: 'dark', surface: '#e6f0e8' },
    dark: { background: '#0c1512', scheme: 'light', surface: '#15211c' },
    defaultAccent: '#15803d',
    adaptive: true,
  },
  {
    id: 'ocean',
    nameKey: 'ocean',
    light: { background: '#f2f7fb', scheme: 'dark', surface: '#e5eef6' },
    dark: { background: '#08131d', scheme: 'light', surface: '#101f2b' },
    defaultAccent: '#0369a1',
    adaptive: true,
  },
  {
    // Maximum contrast, no tint — for a studio whose own brand supplies all the
    // colour there should be.
    id: 'mono',
    nameKey: 'mono',
    light: { background: '#ffffff', scheme: 'dark', surface: '#f4f4f5' },
    dark: { background: '#000000', scheme: 'light', surface: '#111111' },
    defaultAccent: '#111111',
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
