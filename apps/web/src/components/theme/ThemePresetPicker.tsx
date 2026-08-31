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
import { Check, Moon } from 'lucide-react'
import { SURFACE_THEME_PRESETS } from '@linyup/shared'
import type { SurfaceThemePresetId } from '@linyup/shared'
import { Badge } from '@/components/ui/badge'

export interface ThemePresetPickerProps {
  /** The chosen preset id, or '' for a surface still on the legacy fields. */
  value: SurfaceThemePresetId | ''
  onChange: (id: SurfaceThemePresetId) => void
  /** The studio's accent, drawn on each swatch so the pairing is visible before
   *  it is committed. */
  accentColor?: string
  disabled?: boolean
}

export function ThemePresetPicker({
  value,
  onChange,
  accentColor,
  disabled,
}: ThemePresetPickerProps) {
  const t = useTranslations('Themes')
  const selectedPreset = SURFACE_THEME_PRESETS.find((p) => p.id === value) ?? null

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
      </div>

      {/* The hint follows the SELECTED preset, not the picker. Saying "comes
          with a light and a dark version" under a chosen `Ink` would be false —
          it is dark for everyone, which is why it is a separate kind of preset
          at all. */}
      <p className="text-xs text-muted-foreground">
        {!selectedPreset
          ? t('legacyHint')
          : selectedPreset.adaptive
            ? t('adaptiveHint')
            : t('fixedHint')}
      </p>
    </div>
  )
}
