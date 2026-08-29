// Pure badge computation — deliberately SIMPLE, on purpose.
//
// This is a smaller badge set than the mobile app's `BadgesCard.tsx`: no
// team-customized thresholds (`teams/{id}.settings.gamification.badge_thresholds`
// is private — team-member-or-creator only per firestore.rules — and mirroring
// it onto public_profile is a bigger change than this pass), no coach-assigned
// custom badges (same problem: their labels live on the same private doc), and
// no rank/explorer/"special" groups. The web Space is explicitly the SIMPLE
// view of gamification (score/streak/leaderboard/badges) while the mobile app
// is not yet the primary surface — see the module header of
// `GamificationHome.tsx`.
//
// The three groups below (attendance / streak / score) use the SAME numbers
// mobile's `BadgesCard.tsx` DEFAULT_THRESHOLDS falls back to for a team that
// has never customized them, so nothing here is invented — it is the product's
// own default, just not yet override-able from this surface.
//
// Every input is a field already on `Contact` that a contact session may read
// off its OWN document (`isSelfContact` in firestore.rules) — no new mirror
// needed for badges.

export type BadgeGroupKey = 'attendance' | 'streak' | 'score'

export const BADGE_GROUP_KEYS: readonly BadgeGroupKey[] = ['attendance', 'streak', 'score']

export interface BadgeDefinition {
  /** Stable id — also the i18n key suffix (`SpaceGamification.badges.{key}.*`). */
  key: string
  group: BadgeGroupKey
  threshold: number
}

export const BADGE_DEFINITIONS: readonly BadgeDefinition[] = [
  { key: 'first_class', group: 'attendance', threshold: 1 },
  { key: 'dedicated', group: 'attendance', threshold: 10 },
  { key: 'committed', group: 'attendance', threshold: 50 },
  { key: 'on_fire', group: 'streak', threshold: 4 },
  { key: 'unstoppable', group: 'streak', threshold: 8 },
  { key: 'legendary', group: 'streak', threshold: 12 },
  { key: 'rising_star', group: 'score', threshold: 30 },
  { key: 'monthly_star', group: 'score', threshold: 60 },
  { key: 'superstar', group: 'score', threshold: 90 },
]

export interface BadgeStats {
  /** Total sessions attended (`Contact.total_sessions`). */
  totalSessions: number
  /** Best-ever weekly streak (`Contact.max_streak`) — NOT the current streak,
   *  same as mobile: a badge earned once stays earned even after a streak breaks. */
  maxStreak: number
  /** THIS calendar month's score (`Contact.current_month_score`). Carries the
   *  same "resets with the month" quirk as mobile's own score badges — a
   *  superstar badge can be lost when the month turns over. Not a bug this
   *  surface introduces; matching existing product behaviour on purpose. */
  monthScore: number
}

function statValue(group: BadgeGroupKey, stats: BadgeStats): number {
  if (group === 'attendance') return stats.totalSessions
  if (group === 'streak') return stats.maxStreak
  return stats.monthScore
}

export function isBadgeEarned(def: BadgeDefinition, stats: BadgeStats): boolean {
  return statValue(def.group, stats) >= def.threshold
}

export function earnedBadgeCount(stats: BadgeStats): number {
  return BADGE_DEFINITIONS.reduce((count, def) => count + (isBadgeEarned(def, stats) ? 1 : 0), 0)
}
