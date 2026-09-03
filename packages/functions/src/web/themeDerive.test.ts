import assert from 'node:assert/strict'
import {
  deriveThemePreset,
  hexToHsl,
  resolveThemePreset,
  THEME_VARIANTS,
  SURFACE_THEME_PRESETS,
  type ThemeVariantId,
} from '@linyup/shared'

// The derivation's job is to make a studio's colour into a page that is still
// READABLE. These tests are mostly about that guarantee holding for inputs a
// studio can actually pick — including the ones chosen to break it.

const VARIANTS = THEME_VARIANTS.map((v) => v.id)

/** Relative luminance, the thing "light enough for dark text" actually means. */
function luminance(hex: string): number {
  const hsl = hexToHsl(hex)
  assert.ok(hsl, `unparseable: ${hex}`)
  return hsl!.l
}

describe('deriveThemePreset — the contrast guarantee', () => {
  // Every hue, plus the two that break naive ramps: a mid-grey with no hue to
  // carry, and a colour that is already almost white.
  const BASES = [
    '#15803d', '#0369a1', '#b45309', '#6366f1', '#dc2626',
    '#808080', '#fefefe', '#000000', '#f5d0fe',
  ]

  it('the light half is always light enough for the dark text it declares', () => {
    for (const base of BASES) {
      for (const v of VARIANTS) {
        const p = deriveThemePreset(base, v)!
        assert.equal(p.light.scheme, 'dark', `${base}/${v}`)
        assert.ok(luminance(p.light.background) >= 85, `${base}/${v} bg L=${luminance(p.light.background)}`)
        assert.ok(luminance(p.light.surface) >= 85, `${base}/${v} surface`)
      }
    }
  })

  it('the dark half is always dark enough for the light text it declares', () => {
    for (const base of BASES) {
      for (const v of VARIANTS) {
        const p = deriveThemePreset(base, v)!
        assert.equal(p.dark.scheme, 'light', `${base}/${v}`)
        assert.ok(luminance(p.dark.background) <= 28, `${base}/${v} bg L=${luminance(p.dark.background)}`)
        assert.ok(luminance(p.dark.surface) <= 28, `${base}/${v} surface`)
      }
    }
  })

  it('a mid-grey base stays neutral instead of picking up a cast', () => {
    const p = deriveThemePreset('#808080', 'deep')!
    for (const hex of [p.light.background, p.dark.background]) {
      assert.equal(hexToHsl(hex)!.s, 0, `${hex} should be neutral`)
    }
  })

  it('the surface is distinguishable from the background in both halves', () => {
    for (const v of VARIANTS) {
      const p = deriveThemePreset('#0369a1', v)!
      assert.notEqual(p.light.background, p.light.surface, v)
      assert.notEqual(p.dark.background, p.dark.surface, v)
    }
  })
})

describe('deriveThemePreset — the variants actually differ', () => {
  // The complaint this feature answers: the fixed presets' dark halves were all
  // near-black, so "choosing a theme" barely changed the dark view.
  it('deep gives a dark half that is genuinely the colour, not near-black', () => {
    const soft = deriveThemePreset('#15803d', 'soft')!
    const deep = deriveThemePreset('#15803d', 'deep')!
    const softS = hexToHsl(soft.dark.background)!
    const deepS = hexToHsl(deep.dark.background)!
    assert.ok(deepS.s > softS.s, `deep should be more saturated (${deepS.s} vs ${softS.s})`)
    assert.ok(deepS.l > softS.l, `deep should be lighter than near-black (${deepS.l} vs ${softS.l})`)
  })

  it('every variant produces a different page from every other', () => {
    const seen = new Set<string>()
    for (const v of VARIANTS) {
      const p = deriveThemePreset('#6366f1', v)!
      const key = `${p.light.background}|${p.dark.background}`
      assert.equal(seen.has(key), false, `${v} duplicates another variant`)
      seen.add(key)
    }
  })

  it('an unknown variant falls back rather than throwing', () => {
    const p = deriveThemePreset('#6366f1', 'nonsense' as ThemeVariantId)
    assert.ok(p, 'should still derive')
  })

  it('the hue is preserved from the base', () => {
    const base = hexToHsl('#0369a1')!
    const p = deriveThemePreset('#0369a1', 'tinted')!
    assert.ok(Math.abs(hexToHsl(p.light.background)!.h - base.h) < 2)
    assert.ok(Math.abs(hexToHsl(p.dark.background)!.h - base.h) < 2)
  })

  it('a separate dark base drives the dark half only', () => {
    const p = deriveThemePreset('#15803d', 'tinted', '#0369a1')!
    const green = hexToHsl('#15803d')!.h
    const blue = hexToHsl('#0369a1')!.h
    assert.ok(Math.abs(hexToHsl(p.light.background)!.h - green) < 2, 'light half follows the base')
    assert.ok(Math.abs(hexToHsl(p.dark.background)!.h - blue) < 2, 'dark half follows baseDark')
  })
})

describe('hexToHsl', () => {
  it('accepts both shorthand and full hex, with or without the hash', () => {
    for (const v of ['#fff', 'fff', '#ffffff', 'FFFFFF']) {
      assert.equal(hexToHsl(v)?.l, 100, v)
    }
  })

  it('returns null for anything that is not a hex colour', () => {
    for (const v of ['', 'red', 'rgb(0,0,0)', '#12345', 'linear-gradient(red, blue)', '#ggg']) {
      assert.equal(hexToHsl(v), null, v)
    }
  })
})

describe('resolveThemePreset — one door for both kinds', () => {
  it('resolves a registry id', () => {
    assert.equal(resolveThemePreset({ presetId: 'ink' })?.id, 'ink')
  })

  it('derives for custom', () => {
    const p = resolveThemePreset({ presetId: 'custom', base: '#15803d', variantLight: 'deep', variantDark: 'deep' })
    assert.equal(p?.id, 'custom')
    assert.equal(p?.adaptive, true)
  })

  it('returns null when nothing is chosen, so the legacy fallback still runs', () => {
    assert.equal(resolveThemePreset({}), null)
    assert.equal(resolveThemePreset({ presetId: null }), null)
    assert.equal(resolveThemePreset({ presetId: 'not-a-preset' }), null)
  })

  it('returns null for custom with no or an unusable base — the page keeps its old look', () => {
    assert.equal(resolveThemePreset({ presetId: 'custom' }), null)
    assert.equal(resolveThemePreset({ presetId: 'custom', base: 'chartreuse' }), null)
  })

  it('every fixed preset still resolves — custom did not displace the registry', () => {
    for (const preset of SURFACE_THEME_PRESETS) {
      assert.equal(resolveThemePreset({ presetId: preset.id })?.id, preset.id)
    }
  })
})

describe('deriveThemePreset — strength per half', () => {
  it('the two halves take their own ramp', () => {
    const mixed = deriveThemePreset('#15803d', { light: 'soft', dark: 'deep' })!
    const allSoft = deriveThemePreset('#15803d', 'soft')!
    const allDeep = deriveThemePreset('#15803d', 'deep')!
    assert.equal(mixed.light.background, allSoft.light.background, 'light half follows variantLight')
    assert.equal(mixed.dark.background, allDeep.dark.background, 'dark half follows variantDark')
  })

  it('a bare id still means the same in both — the old callers are unchanged', () => {
    const bare = deriveThemePreset('#0369a1', 'deep')!
    const pair = deriveThemePreset('#0369a1', { light: 'deep', dark: 'deep' })!
    assert.deepEqual(bare.light, pair.light)
    assert.deepEqual(bare.dark, pair.dark)
  })
})

describe("deriveThemePreset — 'exact': the colour as it is", () => {
  it('uses a dark base verbatim and declares a dark, non-adaptive page', () => {
    const p = deriveThemePreset('#14213d', 'tinted', null, 'exact')!
    assert.equal(p.light.background, '#14213d')
    assert.equal(p.adaptive, false)
    assert.equal(p.fixedScheme, 'dark')
    assert.equal(p.light.scheme, 'light', 'light TEXT on a dark page')
  })

  it('uses a light base verbatim and declares a light page', () => {
    const p = deriveThemePreset('#faf3e0', 'tinted', null, 'exact')!
    assert.equal(p.light.background, '#faf3e0')
    assert.equal(p.fixedScheme, 'light')
    assert.equal(p.light.scheme, 'dark', 'dark TEXT on a light page')
  })

  it('both halves are the SAME palette, so nothing can render two looks', () => {
    const p = deriveThemePreset('#14213d', 'tinted', null, 'exact')!
    assert.deepEqual(p.light, p.dark)
  })

  it('ignores the strengths entirely — that is what "as is" means', () => {
    const a = deriveThemePreset('#14213d', 'soft', null, 'exact')!
    const b = deriveThemePreset('#14213d', 'deep', null, 'exact')!
    assert.deepEqual(a.light, b.light)
  })

  it('pushes a mid-grey out of the unreadable band rather than shipping it', () => {
    const p = deriveThemePreset('#808080', 'tinted', null, 'exact')!
    const l = hexToHsl(p.light.background)!.l
    assert.ok(l <= 42 || l >= 62, `mid L=${l} would carry no text`)
  })

  it('the surface still separates from the page', () => {
    for (const base of ['#14213d', '#faf3e0']) {
      const p = deriveThemePreset(base, 'tinted', null, 'exact')!
      assert.notEqual(p.light.background, p.light.surface, base)
    }
  })

  it('resolves through the one door, carrying the mode', () => {
    const p = resolveThemePreset({ presetId: 'custom', base: '#14213d', mode: 'exact' })
    assert.equal(p?.adaptive, false)
    assert.equal(p?.light.background, '#14213d')
  })

  it('defaults to adaptive when no mode is stored', () => {
    assert.equal(resolveThemePreset({ presetId: 'custom', base: '#14213d' })?.adaptive, true)
  })
})
