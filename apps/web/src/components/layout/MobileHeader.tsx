'use client'

import { Menu } from 'lucide-react'
import { Logo } from '@/components/Logo'

/**
 * Mobile-only chrome: hamburger to open the nav drawer + logo. On desktop the
 * sidebar is the single navigation surface and there is no top bar.
 *
 * STICKY, because it is the ONLY way to reach navigation on a phone (UX-36).
 * It used to scroll away with the page, so on any long list — contacts, the
 * calendar, bookings — changing section meant scrolling all the way back up
 * first. This matches the pattern the shell already uses for the desktop
 * sidebar (`sticky top-0 h-screen` in the (auth) layout) rather than inventing
 * a second one: document scroll stays the scroll container, so nothing that
 * depends on `window.scrollY` (the contacts scroll-lock, multi-select) changes.
 *
 * z-30 sits under the FloatingDock's fixed lanes (z-40) and the sheet/dialog
 * layer (z-50), and over in-page sticky bars (z-10/z-20) — which now offset
 * themselves by the 3.5rem header height on mobile (`top-14 md:top-0`). Search
 * for that class pair to find every bar that stacks under this header.
 */
export function MobileHeader({ onMobileMenu }: { onMobileMenu: () => void }) {
  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center h-14 px-3 bg-card border-b border-border/60 shadow-[0_1px_3px_0_oklch(0.52_0.24_288_/_0.06)] shrink-0 gap-1.5">
      <button
        type="button"
        onClick={onMobileMenu}
        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      <Logo size={20} />
    </header>
  )
}
