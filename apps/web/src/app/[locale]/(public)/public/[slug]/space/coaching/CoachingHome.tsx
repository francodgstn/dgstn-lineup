'use client'

// The coaching loop, brought to the web Space: goals with nested steps, a
// self-evaluation on any of them, and a performance check-in. None of this
// existed here before — goals/check-ins were mobile-app-exclusive even though
// firestore.rules already permits a contact session to read and write them
// (the `isSelfContact` arms under contacts/{contactId}/goals and
// .../performance_checkins). See CLAUDE.md "Public Space" for the wider
// pattern this follows, and the module notes in useSpaceGoals.ts /
// useSpaceCheckins.ts for the write-side rules this surface is careful not to
// violate.
//
// TEAM DIMENSIONS, IN THREE STEPS — and the fallbacks are not redundant.
//
// `teams/{id}` is unreadable from here: the Space runs on a contact session and
// that document is team-member-or-creator only. So `performance_indicators` is
// mirrored onto the world-readable `public_profile` by `syncTeamPublicProfile`,
// and step one reads it there.
//
// But that mirror is written ON TEAM WRITE, so a studio that configured its
// axes before the mirror existed — or has simply not been edited since — has no
// copy of the field in its profile yet. Step two therefore keeps the earlier
// stand-in: the dimension keys already visible on THIS CONTACT's own goals and
// check-ins are tags a coach really used, which beats defaults that are
// silently wrong for a customised studio. Step three is the canonical five,
// which `resolveCoachingDimensions` already returns for "never configured".
//
// Step two retires itself: once every tenant's profile carries the field, it
// stops being reached. Deleting it before then would regress exactly the
// studios it was written for.

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Target } from 'lucide-react'
import { DEFAULT_COACHING_DIMENSIONS, dimensionLabel, resolveCoachingDimensions } from '@linyup/shared'
import type { PerformanceIndicator } from '@linyup/shared'
import SpaceSignInWall from '../SpaceSignInWall'
import { useSpaceAuth } from '../SpaceAuthProvider'
import { usePublicTeam } from '../../PublicTeamProvider'
import { useSpaceTheme } from '../useSpaceTheme'
import { useSpaceGoals } from './useSpaceGoals'
import { useSpaceCheckins } from './useSpaceCheckins'
import { GoalsSection } from './GoalsSection'
import { CheckinSection } from './CheckinSection'

export default function CoachingHome() {
  const t = useTranslations('SpaceCoaching')
  const tSpace = useTranslations('Space')
  const { isAuthenticated } = useSpaceAuth()
  const { team } = usePublicTeam()
  const { accent, textMain } = useSpaceTheme()
  const goalsState = useSpaceGoals()
  const checkinsState = useSpaceCheckins()

  const dimensions = useMemo<PerformanceIndicator[]>(() => {
    // 1. The studio's real configured list, mirrored onto public_profile.
    if (team?.performance_indicators?.length) {
      return resolveCoachingDimensions({ performance_indicators: team.performance_indicators })
    }
    // 2. Not mirrored yet — stand in with the keys this contact's own data uses.
    const keys = new Set<string>()
    for (const g of goalsState.goals) for (const c of g.categories ?? []) keys.add(c)
    for (const c of checkinsState.checkins) for (const k of Object.keys(c.scores ?? {})) keys.add(k)
    if (keys.size === 0) return resolveCoachingDimensions(undefined)
    return resolveCoachingDimensions({
      performance_indicators: [...keys].map((key) => ({ key, label: dimensionLabel(key, [...DEFAULT_COACHING_DIMENSIONS]) })),
    })
  }, [team?.performance_indicators, goalsState.goals, checkinsState.checkins])

  // Space is a signed-in, personal area — same wall every other module shows.
  if (!isAuthenticated) {
    return <SpaceSignInWall prompt={tSpace('coachingSignInPrompt')} />
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4" style={{ color: accent }} />
        <h1 className="text-lg font-bold" style={{ color: textMain }}>
          {t('pageTitle')}
        </h1>
      </div>

      <GoalsSection state={goalsState} dimensions={dimensions} />
      <CheckinSection state={checkinsState} dimensions={dimensions} />
    </div>
  )
}
