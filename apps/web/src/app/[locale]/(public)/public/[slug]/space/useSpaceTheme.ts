'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { resolveBackground, getTextColor } from '@/lib/bioLink'
import { usePublicTeam } from '../PublicTeamProvider'

// Branding/theme for the contact Portal, derived from the team's bio-link styling.
// Lifted out of SpaceHome so the portal shell and every module render identically.
export interface SpaceTheme {
  team: ReturnType<typeof usePublicTeam>['team']
  isDark: boolean
  onDark: boolean
  bgStyle: CSSProperties['background']
  accent: string
  textMain: string
  textMuted: string
  cardBg: string
  cardBorder: string
}

export function useSpaceTheme(): SpaceTheme {
  const { team } = usePublicTeam()
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    if (team?.bioLinkTheme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [team?.bioLinkTheme])

  const isDark = team?.bioLinkTheme === 'dark' || (team?.bioLinkTheme === 'auto' && systemDark)
  const bg = team?.bioLinkBackground
  const bgStyle = resolveBackground(bg, isDark)
  const onDark = getTextColor(bg, isDark) === 'light'
  const accent = team?.bioLinkAccentColor ?? '#6366f1'

  return {
    team,
    isDark,
    onDark,
    bgStyle,
    accent,
    textMain: onDark ? '#f9fafb' : '#111827',
    textMuted: onDark ? 'rgba(249,250,251,0.65)' : '#6b7280',
    cardBg: onDark ? 'rgba(255,255,255,0.08)' : '#ffffff',
    cardBorder: onDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
  }
}
