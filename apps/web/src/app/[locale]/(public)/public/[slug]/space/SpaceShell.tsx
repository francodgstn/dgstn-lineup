'use client'

import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'
import { useSpaceAuth } from './SpaceAuthProvider'
import { useSpaceTheme } from './useSpaceTheme'
import SpacePortalNav from './SpacePortalNav'
import SignInDialog from './SignInDialog'

// Portal chrome shared by every module page (home / bookings / account): themed
// background, team header + sign-in, the module nav, and the sign-in dialog. The
// course player deliberately does NOT use the shell (it wants full width).
export default function SpaceShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Space')
  const { slug, step, isAuthenticated, contact, logout, openSignIn, closeSignIn } = useSpaceAuth()
  const { team, bgStyle, textMain, textMuted, accent, cardBg, cardBorder } = useSpaceTheme()

  // The sign-in dialog is driven by the auth step, so any trigger (header button
  // or a course card's "sign in to access") opens it via openSignIn().
  const signInOpen = step === 'email' || step === 'code' || step === 'selectContact'

  return (
    <div className="min-h-screen w-full" style={{ background: bgStyle, color: textMain, fontFamily: 'inherit' }}>
      <div className="max-w-[640px] mx-auto px-5 pb-16">
        {/* Header */}
        <div className="pt-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {team?.profileImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.profileImage} alt={team?.name ?? ''} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div
                className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: accent }}
              >
                {team?.name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <h1 className="text-xl font-bold truncate" style={{ color: textMain }}>{team?.name}</h1>
          </div>

          {isAuthenticated && contact ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs hidden sm:inline" style={{ color: textMuted }}>
                {t('signedInAs', { name: `${contact.firstname} ${contact.lastname}` })}
              </span>
              <button
                onClick={() => logout()}
                className="h-8 w-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ background: cardBg, border: `1px solid ${cardBorder}`, color: textMain }}
                title={t('signOut')}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => openSignIn()}
              className="text-sm font-medium px-4 py-1.5 rounded-full transition-opacity hover:opacity-80 shrink-0"
              style={{ background: accent, color: '#fff' }}
            >
              {t('signIn')}
            </button>
          )}
        </div>

        <SpacePortalNav />

        {children}
      </div>

      <SignInDialog open={signInOpen} onOpenChange={(o) => { if (!o) closeSignIn() }} slug={slug} />
    </div>
  )
}
