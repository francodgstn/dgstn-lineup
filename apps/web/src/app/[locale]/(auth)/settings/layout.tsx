'use client'

// Master-detail shell for the whole /settings/* area. The rail is rendered once
// here and stays mounted as the detail pane (children) swaps — so navigating
// between settings sections never re-flashes the rail.
//
// The shell itself lives in @/components/settings/SettingsShell because the
// "Public pages" section renders at /public-page, outside this segment, and has
// to look identical (UX-61). One shell, two layouts.

import { SettingsShell } from '@/components/settings/SettingsShell'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>
}
