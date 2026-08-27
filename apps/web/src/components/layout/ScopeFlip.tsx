'use client'

/**
 * FLIP BACK TO THE SCOPE YOU WERE JUST IN — the alt-tab affordance.
 *
 * The one real cost of making an organisation a scope is the click to get back,
 * and an org admin who also runs a studio pays it all day.
 *
 * IT TOGGLES BETWEEN TWO; IT DOES NOT CYCLE N. What makes alt-tab worth having
 * is the instant flip between the last two things — the part everyone finds
 * fiddly is holding a modifier to rotate through a list. With three or more
 * scopes the switcher menu is already the better tool, so this always means
 * "back to the previous one" and never "next in some order".
 *
 * A BUTTON, NOT ONLY A CHORD. A bare shortcut is undiscoverable; the sidebar
 * search makes the same point about itself. The control names its TARGET and
 * carries the chord — in its tooltip and accessible name rather than inline,
 * for the measured reason given above the component. NO PREVIOUS SCOPE, NO
 * CONTROL: in a first session it is absent rather than present-and-guessing,
 * because a toggle that lands somewhere arbitrary is worse than no toggle.
 *
 * ── THE CHORD IS Alt+O, AND THE GUARD IS NOT OPTIONAL ───────────────────────
 *
 * Windows-first, on Swiss, German and French keyboards — which eliminates almost
 * everything. Ctrl+Shift+O opens the bookmark manager in Chrome and Edge and the
 * Library in Firefox; most of the Ctrl+Shift+letter space is similarly spoken
 * for. Alt+S is already bound by the search panel. Alt is the app's own
 * precedent for exactly this situation (see the note beside that binding).
 *
 * `!e.ctrlKey` IS THE LOAD-BEARING PART. On those three layouts AltGr produces
 * `@`, `#`, `~` and `|`, and the browser reports AltGr as ctrlKey AND altKey
 * together — so a bare `e.altKey` handler fires while somebody is typing an
 * email address into a form on the page. The typing guard below is the second
 * half of the same concern.
 */

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { Route } from 'next'
import { Repeat2 } from 'lucide-react'
import { useScope } from '@/contexts/ScopeContext'

/** Is the keystroke going into something the person is typing in? */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** The global chord. Mounted once by the shell, beside the other key handlers. */
export function useScopeFlipShortcut() {
  const { previous, hrefFor } = useScope()
  const router = useRouter()

  useEffect(() => {
    if (!previous) return
    function onKey(e: KeyboardEvent) {
      // `e.key` rather than `e.code`: the letter the layout actually produces is
      // what the tooltip promises, and Alt+O on a Swiss keyboard is still O.
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key !== 'o' && e.key !== 'O') return
      if (isTyping(e.target)) return
      e.preventDefault()
      router.push(hrefFor(previous!) as Route)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previous, hrefFor, router])
}

/**
 * Mounts the chord ONCE.
 *
 * The hook cannot simply live in the sidebar: `SidebarContent` renders twice —
 * the desktop aside and the mobile drawer — so the listener would be registered
 * twice and one keypress would navigate twice. This renders nothing and exists
 * only to give the handler a single home inside the scope provider.
 */
export function ScopeFlipShortcut() {
  useScopeFlipShortcut()
  return null
}

/**
 * The visible affordance. Renders nothing when there is nowhere to flip to.
 *
 * A GLYPH IN BOTH MODES, and that is a concession made on measurement rather
 * than taste. It used to render the target's name inline, which is what the
 * design asked for — "the affordance says what it will do before it does it".
 * On the header row it shares with the switcher, the QR and the utilities, that
 * name was 182px on a 223px row: the switcher collapsed to 18px with its own
 * text overflowing, and the last two controls landed outside the sidebar
 * entirely.
 *
 * So the promise is kept by the TOOLTIP and the accessible name, both of which
 * still say exactly which scope this goes to, rather than by inline text there
 * is no room for.
 */
export function ScopeFlip() {
  const t = useTranslations('TopBar')
  const { previous, hrefFor } = useScope()
  const router = useRouter()

  if (!previous) return null

  // A scope whose name has not loaded yet still flips — the label falls back to
  // the kind rather than naming nothing.
  const name =
    previous.name || (previous.kind === 'org' ? t('scopeOrganisation') : t('scopeStudio'))

  return (
    <button
      type="button"
      onClick={() => router.push(hrefFor(previous) as Route)}
      title={`${t('flipToPrevious', { name })} · Alt+O`}
      aria-label={t('flipToPrevious', { name })}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Repeat2 className="h-4 w-4 shrink-0" />
    </button>
  )
}
