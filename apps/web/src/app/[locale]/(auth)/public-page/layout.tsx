'use client'

// Puts the "Public pages" hub inside the settings shell — rail on the left, hub
// in the detail pane — so the one settings section whose route is not under
// /settings/* still reads as a settings panel rather than a bare full page
// (UX-61, reported by Franco).
//
// WHY A ROUTE GROUP. The route stays /public-page: it is bookmarked, and its
// siblings /public-page/shop and /public-page/space are linked from the main nav
// and from How-to, so renaming the prefix would break links already in the world.
// A layout at public-page/layout.tsx would have wrapped those two full-width
// management pages in the settings rail as well, which they are not. The `(hub)`
// group adds no path segment, so /public-page is unchanged while the shell
// applies to this page only.

import { SettingsShell } from '@/components/settings/SettingsShell'

export default function PublicPagesHubLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>
}
