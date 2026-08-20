'use client'

// Puts "Public pages" and BOTH its surface sections inside the settings shell —
// rail on the left, section in the detail pane — so the settings section whose
// route is not under /settings/* still reads as a settings panel rather than a
// bare full page (UX-61, reported by Franco).
//
// THIS USED TO COVER THE HUB ALONE, via a `(hub)` route group. The note there
// said a layout at this level "would have wrapped those two full-width
// management pages in the settings rail as well, which they are not" — and that
// belief was the defect. /public-page/space held one switch, a status dot the
// hub already draws, and two links out; stretched full-width it read as an
// unfinished page rather than a small section, which is exactly what it is.
// /public-page/shop holds more (channels, Connect, currency) but is the same
// KIND of thing, and two siblings rendered two different ways is what made
// either look wrong.
//
// So the group is gone and the shell applies to all three. The routes are
// unchanged — /public-page, /public-page/shop, /public-page/space are
// bookmarked, linked from the main nav and named in How-to — which is the
// property the route group was protecting and this keeps for free: a layout
// adds no path segment either.

import { SettingsShell } from '@/components/settings/SettingsShell'

export default function PublicPagesLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>
}
