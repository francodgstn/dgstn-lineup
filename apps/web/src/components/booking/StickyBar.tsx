'use client'

import { COLOR_PRESETS } from '@/lib/colors'

// Shared fixed bottom "summary + confirm" bar for the public booking flows —
// the class BookingForm ('sessions'/'who'/'returning'/'details' steps) and the
// appointment picker ('time'/'book' steps). Extracted from BookingForm.tsx
// verbatim (same markup, animation, shadow); generalized so the caller composes
// the display strings (provider label, date/time line) and this stays
// flow-agnostic. Fixed at max-w-2xl for BOTH flows regardless of the content
// column width — the original class-flow behaviour.

// Deterministic gradient from a name — the thumbnail fallback when an activity
// has no image (appointments never do). Exported because BookingForm's activity
// cards use the same fallback.
export function activityGradient(name: string): string {
  const colors = COLOR_PRESETS
  const i = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length
  return `linear-gradient(135deg, ${colors[i]}, ${colors[(i + 2) % colors.length]})`
}

/**
 * How much vertical room the bar needs. FlowShell reserves this as bottom padding
 * on the page variant; it used to be duplicated as a local constant in both flows.
 */
export const STICKY_H = 100

/**
 * Where the bar anchors.
 *  - 'viewport'  — fixed to the bottom of the window (full-page flows)
 *  - 'container' — sticky inside its scroll parent (inside a dialog/sheet, where
 *                  a viewport-fixed z-[100] bar would escape the panel)
 *
 * Required on purpose: there are exactly two call sites, and a forgotten default
 * is precisely how a bar ends up floating over a modal it doesn't belong to.
 */
export type StickyBarPosition = 'viewport' | 'container'

export interface StickyBarProps {
  title: string
  /** Activity image; a name-derived gradient is used when absent. */
  imageUrl?: string | null
  /** Already-composed "with Anna Schmidt" — null hides the line. */
  providerLabel?: string | null
  /** Already-composed "Mon, 20 July · 08:00–08:30" — null hides the date/loc rows. */
  dateTimeLabel?: string | null
  location?: string | null
  accentColor?: string | null
  position: StickyBarPosition
  showConfirm: boolean
  submitting: boolean
  /**
   * Greys the Confirm without hiding it — the state the consent step needs: a
   * visitor who has not ticked yet must see the control they are working
   * towards, and must not be able to submit a booking with nothing signed.
   * Hiding it instead would read as "there is nothing more to do here".
   */
  confirmDisabled?: boolean
  confirmLabel: string
  submittingLabel: string
  onConfirm: () => void
}

export function StickyBar({
  title,
  imageUrl,
  providerLabel,
  dateTimeLabel,
  location,
  accentColor,
  position,
  showConfirm,
  submitting,
  confirmDisabled,
  confirmLabel,
  submittingLabel,
  onConfirm,
}: StickyBarProps) {
  const bg = imageUrl ? `url("${imageUrl}")` : activityGradient(title)
  const anchor =
    position === 'viewport'
      ? 'fixed bottom-0 left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] max-w-2xl z-[100] rounded-t-2xl border-b-0'
      : // Inside a panel the bar is part of the flex column: full width, no
        // transform, and a low z so it can't paint over the dialog's own chrome.
        'sticky bottom-0 w-full z-10 border-x-0 border-b-0'

  return (
    <div
      className={`${anchor} flex items-center gap-3 p-3 sm:p-4 border bg-background/95 backdrop-blur-md`}
      style={{
        boxShadow: '0 -8px 32px rgba(0,0,0,0.10), 0 -2px 8px rgba(0,0,0,0.06)',
        animation: 'slideUpBar 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      <style>{`
        @keyframes slideUpBar {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* Thumbnail */}
      <div
        className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg shrink-0 bg-muted"
        style={{
          background: bg,
          backgroundSize: imageUrl ? 'cover' : '100% 100%',
          backgroundPosition: 'center',
        }}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{title}</p>
        {providerLabel && <p className="text-xs text-muted-foreground italic">{providerLabel}</p>}
        {dateTimeLabel && (
          <div className="flex flex-col gap-0.5 mt-0.5">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <svg
                className="h-3 w-3 shrink-0 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{dateTimeLabel}</span>
            </div>
            {location && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <svg
                  className="h-3 w-3 shrink-0 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="truncate">{location}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm */}
      {showConfirm && (
        <button
          onClick={onConfirm}
          disabled={submitting || confirmDisabled === true}
          style={accentColor ? { backgroundColor: accentColor } : undefined}
          className="shrink-0 rounded-xl bg-primary text-primary-foreground font-semibold px-5 py-2.5 text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {submitting ? submittingLabel : confirmLabel}
        </button>
      )}
    </div>
  )
}
