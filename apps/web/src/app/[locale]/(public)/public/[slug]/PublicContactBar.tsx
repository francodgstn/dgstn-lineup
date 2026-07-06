'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import type { Route } from 'next'
import { CircleUser, LogIn, LogOut } from 'lucide-react'
import { usePublicContactAuth } from './PublicContactAuthProvider'
import { useSpaceTheme } from './space/useSpaceTheme'
import SignInDialog from './space/SignInDialog'

// Shared sign-in control for public surfaces that lack their own auth chrome
// (bio-link, booking, signup, documents, shop, coaching …). Space has its own
// header control and the full website (/site) has its own design, so both opt out.
// Backed by the lifted contact-session context, so a login persists across surfaces.
export function PublicContactBar() {
  const t = useTranslations('Space')
  const pathname = usePathname()
  const { slug, step, isAuthenticated, contact, openSignIn, closeSignIn, logout } =
    usePublicContactAuth()
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()

  const signInOpen =
    step === 'email' || step === 'code' || step === 'selectContact' || step === 'register'
  const onSignInOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeSignIn()
    },
    [closeSignIn]
  )

  // Precise segment match (so a slug like "spacegym" isn't mistaken for /space).
  const onSurface = (s: string) => pathname.endsWith(`/${s}`) || pathname.includes(`/${s}/`)
  if (onSurface('space') || onSurface('site')) return null

  return (
    <>
      <div className="fixed right-3 top-3 z-40">
        {isAuthenticated && contact ? (
          <div
            className="flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-xs font-medium shadow-sm"
            style={{ background: cardBg, border: `1px solid ${cardBorder}`, color: textMain }}
          >
            {/* Name links to the contact's personal Space (their portal home) */}
            <Link
              href={`/public/${slug}/space` as Route}
              title={t('openSpace')}
              className="flex min-w-0 items-center gap-1 transition-opacity hover:opacity-70"
            >
              <CircleUser className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
              <span className="max-w-[120px] truncate underline-offset-2 hover:underline">
                {contact.firstname}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => logout()}
              aria-label={t('signOut')}
              title={t('signOut')}
              className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-70"
              style={{ color: textMuted }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openSignIn()}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm transition-opacity hover:opacity-80"
            style={{ background: accent, color: '#fff' }}
          >
            <LogIn className="h-3.5 w-3.5" />
            {t('signIn')}
          </button>
        )}
      </div>
      <SignInDialog open={signInOpen} onOpenChange={onSignInOpenChange} slug={slug} />
    </>
  )
}
