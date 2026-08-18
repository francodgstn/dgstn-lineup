'use client'

import type { Route } from 'next'
import { X } from 'lucide-react'
import { BioLinkShell } from '@/app/[locale]/(public)/public/[slug]/BioLinkShell'
import { useBookingChrome } from './BookingChrome'
import { STICKY_H } from './StickyBar'

// ─── FlowShell ────────────────────────────────────────────────────────────────
//
// The ONE frame for both public booking funnels (class `BookingForm` and
// `AppointmentPicker`). Neither flow should render `BioLinkShell` directly any
// more: this is the single place that knows how a flow is framed, so adding a
// chrome can't miss a step.
//
// Why it owns the sticky bar as a `bar` SLOT rather than leaving it a sibling:
// on the page, the bar is `position: fixed`, so rendering it next to the shell
// works. Inside a dialog it has to live in the panel's flex column, or it escapes
// the panel. Making it a slot lets one component place it correctly per chrome.

interface FlowShellProps {
  teamName: string
  slug: string
  accentColor?: string | null
  children: React.ReactNode
  /** Wider content column (session grids, the time picker). Page chrome only —
   *  the overlay panel has a fixed width. */
  wide?: boolean
  showBranding?: boolean
  /** Where the header's back affordance goes (page chrome). See `returnHref`. */
  backTo?: { href: Route; label?: string }
  /** The sticky summary/confirm bar, or null on steps that don't show one. */
  bar?: React.ReactNode
  /** Shown as the overlay panel's title; falls back to the team name. */
  overlayTitle?: string
}

export function FlowShell({
  teamName,
  slug,
  accentColor,
  children,
  wide,
  showBranding,
  backTo,
  bar,
  overlayTitle,
}: FlowShellProps) {
  const chrome = useBookingChrome()

  if (chrome.kind === 'page') {
    // Byte-for-byte the previous arrangement: full-height shell, bar fixed to the
    // viewport as a sibling, shell reserving room for it.
    return (
      <>
        <BioLinkShell
          teamName={teamName}
          slug={slug}
          accentColor={accentColor}
          wide={wide}
          stickyBarHeight={bar ? STICKY_H : undefined}
          showBranding={showBranding}
          backTo={backTo}
        >
          {children}
        </BioLinkShell>
        {bar}
      </>
    )
  }

  // Overlay: a flex column that fills the panel the host gives us. No
  // `min-h-screen`, no global accent style tag, no "Powered by Linyup" — the
  // page behind the panel already carries the studio's own footer.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{overlayTitle || teamName}</p>
        <button
          type="button"
          onClick={chrome.onClose}
          aria-label="Close"
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* overscroll-contain stops a flick at the end of the list from scrolling
          the website behind the panel. */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-6">
        {children}
      </div>

      {bar}
    </div>
  )
}
