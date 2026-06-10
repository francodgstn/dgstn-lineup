'use client'

import { Menu } from 'lucide-react'
import { Logo } from '@/components/Logo'

/**
 * Mobile-only chrome: hamburger to open the nav drawer + logo. On desktop the
 * sidebar is the single navigation surface and there is no top bar.
 */
export function MobileHeader({ onMobileMenu }: { onMobileMenu: () => void }) {
  return (
    <header className="md:hidden flex items-center h-14 px-3 bg-card border-b border-border/60 shadow-[0_1px_3px_0_oklch(0.52_0.24_288_/_0.06)] shrink-0 gap-1.5">
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
