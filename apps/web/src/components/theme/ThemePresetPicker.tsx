'use client'

/**
 * THE THEME PICKER for a public surface — one control, both colour schemes.
 *
 * It replaces the pair it sits in place of: a light/dark/auto switch AND a free
 * background colour or gradient. Those two crossed, and every crossing was a way
 * to ship an unreadable page — the full list is in the header of
 * `packages/shared/src/types/themePreset.ts`, which is also the registry this
 * renders.
 *
 * ── THE SWATCH SHOWS BOTH HALVES ────────────────────────────────────────────
 * An adaptive preset is drawn split: what a viewer in light mode sees on the
 * left, what a viewer in dark mode sees on the right. That IS the feature — the
 * thing the old controls could not express is "and it looks right in dark mode
 * too" — so the picker shows it rather than claiming it in a caption. A preset
 * that is deliberately one look (`adaptive: false`) is drawn whole, with a chip
 * saying so, because a split swatch would promise an adaptation it does not do.
 *
 * ── NOTHING IS PRESELECTED FOR A LEGACY SURFACE ─────────────────────────────
 * `value` is empty for a studio that set its look with the old controls, and the
 * picker says so instead of highlighting a preset it did not choose. Its page
 * keeps rendering from the legacy fields until it picks one here — see the
 * fallback in `buildPalette` / `resolveBioLinkPalette`. Converting a live public
 * page as a side effect of saving an unrelated field would be a change nobody
 * asked for.
 */

import { useTranslations } from 'next-intl'
import { Check, Moon, Palette } from 'lucide-react'
import {
  SURFACE_THEME_PRESETS,
  THEME_VARIANTS,
  DEFAULT_THEME_VARIANT,
  DEFAULT_THEME_MODE,
  deriveThemePreset,
} from '@linyup/shared'
import { ColorPicker } from '@/components/ui/color-picker'
import type { SurfaceThemePresetId, ThemeVariantId, ThemeMode } from '@linyup/shared'

/** What the colour input starts on before a studio has chosen. The product's
 *  own primary, so the first custom theme a studio sees is recognisably Linyup
 *  rather than an arbitrary hue. */
const DEFAULT_CUSTOM_BASE = '#6366f1'
import { Badge } from '@/components/ui/badge'

export interface ThemePresetPickerProps {
  /** The chosen preset id, or '' for a surface still on the legacy fields. */
  value: SurfaceThemePresetId | ''
  onChange: (id: SurfaceThemePresetId) => void
  /** The studio's accent, drawn on each swatch so the pairing is visible before
   *  it is committed. */
  accentColor?: string
  disabled?: boolean
  // ── the custom theme, derived from the studio's own colour ───────────────
  // Absent handlers mean "this surface does not offer a custom theme", and the
  // tile is not drawn at all — a picker that shows an option it cannot save is
  // worse than one that shows six.
  base?: string
  baseDark?: string
  /** Strength per half — a studio judges the light and dark pages separately. */
  variantLight?: string
  variantDark?: string
  /** 'adaptive' (two pages) or 'exact' (the colour as it is, one look). */
  mode?: string
  onCustomChange?: (next: {
    base: string
    baseDark?: string
    variantLight: string
    variantDark: string
    mode: string
  }) => void
}

export function ThemePresetPicker({
  value,
  onChange,
  accentColor,
  disabled,
  base,
  baseDark,
  variantLight,
  variantDark,
  mode,
  onCustomChange,
}: ThemePresetPickerProps) {
  const t = useTranslations('Themes')
  const offersCustom = !!onCustomChange
  const isCustom = value === 'custom'
  const effectiveBase = base || DEFAULT_CUSTOM_BASE
  const vLight = (variantLight as ThemeVariantId) || DEFAULT_THEME_VARIANT
  const vDark = (variantDark as ThemeVariantId) || DEFAULT_THEME_VARIANT
  // Derived for the SWATCHES as well as for the page, through the same function
  // the renderer uses — so what a studio previews here is what ships, rather
  // than a second approximation of it.
  const effectiveMode = (mode as ThemeMode) || DEFAULT_THEME_MODE
  const isExact = effectiveMode === 'exact'
  const derived = deriveThemePreset(
    effectiveBase,
    { light: vLight, dark: vDark },
    baseDark,
    effectiveMode
  )
  /** One writer for the four fields — they are one choice, and a base that
   *  landed without the strengths picked beside it would render as something
   *  nobody chose. */
  const emit = (
    patch: Partial<{
      base: string
      baseDark?: string
      variantLight: string
      variantDark: string
      mode: string
    }>
  ) =>
    onCustomChange?.({
      base: effectiveBase,
      baseDark,
      variantLight: vLight,
      variantDark: vDark,
      mode: effectiveMode,
      ...patch,
    })
  const selectedPreset = isCustom
    ? derived
    : (SURFACE_THEME_PRESETS.find((p) => p.id === value) ?? null)

  /** Turning the custom tile on has to WRITE the colour, not just select the
   *  id: a 'custom' preset with no stored base resolves to null and the page
   *  would fall back to its legacy look with no explanation. */
  const pickCustom = () => {
    emit({})
    onChange('custom')
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SURFACE_THEME_PRESETS.map((preset) => {
          const selected = preset.id === value
          const accent = accentColor || preset.defaultAccent
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset.id)}
              aria-pressed={selected}
              className={`group relative overflow-hidden rounded-xl border text-left transition-all disabled:opacity-60 ${
                selected ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/50'
              }`}
            >
              <div className="flex h-16">
                {preset.adaptive ? (
                  <>
                    <div
                      className="flex-1"
                      style={{ background: preset.light.background }}
                      aria-hidden
                    />
                    <div
                      className="flex-1"
                      style={{ background: preset.dark.background }}
                      aria-hidden
                    />
                  </>
                ) : (
                  <div
                    className="flex-1"
                    style={{
                      background:
                        preset.fixedScheme === 'light'
                          ? preset.light.background
                          : preset.dark.background,
                    }}
                    aria-hidden
                  />
                )}
              </div>
              {/* The accent, drawn over the seam so it is read against both
                  halves at once — which is exactly how a viewer will meet it. */}
              <span
                className="absolute left-1/2 top-8 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70 shadow"
                style={{ background: accent }}
                aria-hidden
              />
              {selected && (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <div className="flex items-center gap-1.5 px-2.5 py-2">
                <span className="truncate text-xs font-medium">
                  {t(preset.nameKey as Parameters<typeof t>[0])}
                </span>
                {!preset.adaptive && (
                  <Badge variant="outline" className="gap-1 px-1 py-0 text-[9px] font-normal">
                    <Moon className="h-2.5 w-2.5" />
                    {t('alwaysDark')}
                  </Badge>
                )}
              </div>
            </button>
          )
        })}

        {/* THE CUSTOM TILE sits with the presets rather than under them: it is
            another way to answer the same question, and a studio comparing
            looks should see it beside the six it is choosing between. */}
        {offersCustom && (
          <button
            type="button"
            disabled={disabled}
            onClick={pickCustom}
            aria-pressed={isCustom}
            className={`group relative overflow-hidden rounded-xl border text-left transition-all disabled:opacity-60 ${
              isCustom ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/50'
            }`}
          >
            {/* Drawn whole in exact mode, split otherwise — the same rule the
                fixed presets follow, so the swatch never promises an adaptation
                the theme does not do. */}
            <div className="flex h-16">
              {isExact ? (
                <div className="flex-1" style={{ background: derived?.light.background }} aria-hidden />
              ) : (
                <>
                  <div className="flex-1" style={{ background: derived?.light.background }} aria-hidden />
                  <div className="flex-1" style={{ background: derived?.dark.background }} aria-hidden />
                </>
              )}
            </div>
            <span
              className="absolute left-1/2 top-8 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70 shadow"
              style={{ background: accentColor || derived?.defaultAccent }}
              aria-hidden
            />
            {isCustom && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-2">
              <Palette className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs font-medium">{t('custom')}</span>
            </div>
          </button>
        )}
      </div>

      {/* THE CONTROLS APPEAR ONLY WHEN CUSTOM IS CHOSEN. Shown always, two
          colour inputs and a three-way switch would read as settings that apply
          to whatever preset is selected — and they do not. */}
      {offersCustom && isCustom && (
        <div className="space-y-3 rounded-lg border p-3">
          {/* THE MODE COMES FIRST because it decides what the rest of the panel
              even is: 'exact' has no second page to configure, so the dark row
              below does not render. */}
          <div className="flex flex-wrap gap-1.5">
            {(['adaptive', 'exact'] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={disabled}
                aria-pressed={effectiveMode === m}
                onClick={() => emit({ mode: m })}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  effectiveMode === m ? 'border-primary bg-primary/5 font-medium' : 'hover:border-primary/50'
                }`}
              >
                {t(m === 'adaptive' ? 'modeAdaptive' : 'modeExact')}
              </button>
            ))}
          </div>

          {/* ONE ROW PER PAGE — the colour and its strength together, because
              they are judged together: a studio looks at the light page, sets
              its colour and how strongly it shows, then does the same for the
              dark one. Splitting them into a colours block and a strengths
              block made the reader pair them up by position (Franco,
              2026-09-03). */}
          {(isExact
            ? ([{ key: 'light' as const, label: t('modeExactRow'), colour: effectiveBase, variant: vLight }])
            : ([
                { key: 'light' as const, label: t('variantLightLabel'), colour: effectiveBase, variant: vLight },
                { key: 'dark' as const, label: t('variantDarkLabel'), colour: baseDark || effectiveBase, variant: vDark },
              ])
          ).map((row) => (
            <div key={row.key} className="space-y-1.5">
              <span className="block text-xs font-medium">{row.label}</span>
              <div className="flex flex-wrap items-center gap-2">
                <ColorPicker
                  value={row.colour}
                  disabled={disabled}
                  aria-label={row.label}
                  className="h-8 w-8"
                  onChange={(hex) =>
                    emit(row.key === 'light' ? { base: hex } : { baseDark: hex })
                  }
                />
                {/* The dark row's colour is OPTIONAL: absent it follows the
                    base, and this is the way back to that — an input cannot
                    express "unset" by itself. */}
                {row.key === 'dark' && baseDark && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => emit({ baseDark: undefined })}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {t('baseDarkClear')}
                  </button>
                )}
                {/* Strength does not apply in exact mode — the colour is used
                    as it is, which is the whole meaning of the mode. */}
                {!isExact && (
                  <div className="flex flex-wrap gap-1.5">
                    {THEME_VARIANTS.map((v) => {
                      const on = v.id === row.variant
                      const preview = deriveThemePreset(
                        effectiveBase,
                        row.key === 'light' ? { light: v.id, dark: vDark } : { light: vLight, dark: v.id },
                        baseDark
                      )
                      const swatch =
                        row.key === 'light' ? preview?.light.background : preview?.dark.background
                      return (
                        <button
                          key={v.id}
                          type="button"
                          disabled={disabled}
                          aria-pressed={on}
                          onClick={() =>
                            emit(row.key === 'light' ? { variantLight: v.id } : { variantDark: v.id })
                          }
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                            on ? 'border-primary bg-primary/5 font-medium' : 'hover:border-primary/50'
                          }`}
                        >
                          <span
                            className="h-4 w-6 shrink-0 rounded-sm border"
                            style={{ background: swatch }}
                            aria-hidden
                          />
                          {t(v.nameKey as Parameters<typeof t>[0])}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The hint follows the SELECTED preset, not the picker. Saying "comes
          with a light and a dark version" under a chosen `Ink` would be false —
          it is dark for everyone, which is why it is a separate kind of preset
          at all. */}
      <p className="text-xs text-muted-foreground">
        {isCustom
          ? t(isExact ? 'customExactHint' : 'customHint')
          : !selectedPreset
            ? t('legacyHint')
            : selectedPreset.adaptive
              ? t('adaptiveHint')
              : t('fixedHint')}
      </p>
    </div>
  )
}
