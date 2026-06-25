'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from '@/i18n/navigation'
import { QrCode, Sun, Moon, Monitor, Compass, LogOut, BarChart3, Settings } from 'lucide-react'
import { posthog } from '@/lib/posthog'
import { START_TOUR_EVENT } from '@/components/onboarding/ProductTour'
import { QRDialog } from '@/components/layout/QRDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

function UserAvatar({ email }: { email: string | null }) {
  const initial = email?.[0]?.toUpperCase() ?? '?'
  return (
    <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold select-none shrink-0">
      {initial}
    </div>
  )
}

/**
 * Sidebar-bottom user card: avatar + email + team name opening the account
 * dropdown (theme, language, replay tour, sign out), with a QR shortcut beside.
 */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations('TopBar')
  const tNav = useTranslations('Nav')
  const tOnb = useTranslations('Onboarding')
  const { user, team } = useAuth()
  const { theme, setTheme } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const locale = useLocale()
  const [qrOpen, setQrOpen] = useState(false)

  // Product analytics opt-out. Analytics runs under legitimate interest; this lets
  // a customer turn it off. PostHog persists + respects the choice across loads.
  const analyticsEnabled = !!process.env.NEXT_PUBLIC_POSTHOG_KEY
  const [analyticsOptedOut, setAnalyticsOptedOut] = useState(false)
  useEffect(() => {
    if (!analyticsEnabled) return
    try {
      setAnalyticsOptedOut(posthog.has_opted_out_capturing())
    } catch {
      /* posthog not ready — default to opted-in */
    }
  }, [analyticsEnabled])

  function toggleAnalytics() {
    if (analyticsOptedOut) {
      posthog.opt_in_capturing()
      setAnalyticsOptedOut(false)
    } else {
      posthog.opt_out_capturing()
      setAnalyticsOptedOut(true)
    }
  }

  async function handleSignOut() {
    const { signOut } = await import('@/lib/auth')
    await signOut()
    router.push('/login')
  }

  return (
    <>
      <div className={`flex gap-1 ${collapsed ? 'flex-col items-center' : 'items-center'}`}>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('account')}
            title={collapsed ? (user?.email ?? t('account')) : undefined}
            className={`flex items-center gap-2.5 rounded-lg hover:bg-muted transition-colors text-left min-w-0 ${
              collapsed ? 'p-1.5 justify-center' : 'flex-1 px-2 py-1.5'
            }`}
          >
            <UserAvatar email={user?.email ?? null} />
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user?.email}</p>
                {team?.name && (
                  <p className="text-[11px] text-muted-foreground truncate">{team.name}</p>
                )}
              </div>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align={collapsed ? 'start' : 'end'} side="top" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium truncate">{user?.email}</span>
                  {team?.name && (
                    <span className="text-xs text-muted-foreground truncate">{team.name}</span>
                  )}
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />

            {/* Theme toggle — Light / Dark / System (follow OS) */}
            <div className="px-2 py-1.5">
              <div className="flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 text-xs transition-colors ${
                    theme === 'light' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  <Sun className="h-3 w-3" />
                  {t('lightMode')}
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('dark')}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 text-xs transition-colors ${
                    theme === 'dark' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  <Moon className="h-3 w-3" />
                  {t('darkMode')}
                </button>
                <button
                  type="button"
                  onClick={() => setTheme('system')}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 text-xs transition-colors ${
                    theme === 'system' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  <Monitor className="h-3 w-3" />
                  {t('systemMode')}
                </button>
              </div>
            </div>
            {/* Language switcher */}
            <div className="px-2 py-1.5">
              <Select value={locale} onValueChange={(l) => { if (l) router.replace(pathname, { locale: l }) }}>
                <SelectTrigger className="h-7 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="it">Italiano</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Product analytics opt-out (only when analytics is configured) */}
            {analyticsEnabled && (
              <div className="px-2 py-1.5">
                <button
                  type="button"
                  onClick={toggleAnalytics}
                  aria-pressed={!analyticsOptedOut}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xs font-medium">{t('analytics')}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {t('analyticsHint')}
                      </span>
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      analyticsOptedOut
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {analyticsOptedOut ? t('analyticsOff') : t('analyticsOn')}
                  </span>
                </button>
              </div>
            )}
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <Settings className="h-4 w-4 mr-2" />
              {tNav('settings')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}>
              <Compass className="h-4 w-4 mr-2" />
              {tOnb('replayTour')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleSignOut} variant="destructive">
              <LogOut className="h-4 w-4 mr-2" />
              {tNav('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* QR codes shortcut */}
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          title={t('qrTitle')}
          className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <QrCode className="h-4 w-4" />
        </button>
      </div>

      <QRDialog open={qrOpen} onClose={() => setQrOpen(false)} team={team} />
    </>
  )
}
