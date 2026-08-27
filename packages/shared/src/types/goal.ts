// The coaching spine — ONE model behind what the UI shows as goals, steps and
// check-ins.
//
// Goals and tasks were never two collections: both are `contacts/{id}/goals/{id}`
// docs discriminated by `type`. What was missing is the CONTAINMENT — a task is
// almost always in service of a goal — and that is what `parent_goal_id` adds.
// A task with no parent is not an orphan: it falls into a VIRTUAL "General"
// group that no document backs, so there is nothing to create, migrate, or
// clean up when the last unparented task is filed.
//
// ONE VOCABULARY. Goal categories and performance-check-in axes used to be two
// unrelated lists, which meant a check-in's weakest axis could never point at a
// goal category — the single connection that turns a self-rating widget into
// the front of a coaching loop. They are now the same team-configurable list;
// see `resolveCoachingDimensions`. Note the `Goal.categories` comment always
// said "team-configured indicator keys": the divergence was drift, not design.

import type { Timestamp } from './common'

export type GoalType = 'goal' | 'task'
export type GoalStatus = 'open' | 'in_progress' | 'achieved' | 'abandoned'
export type GoalCreatedBy = 'coach' | 'student'

// ─── the shared vocabulary ───────────────────────────────────────────────────

/**
 * One dimension of a contact's practice — used BOTH as a goal category and as a
 * performance check-in axis. Stored on the team at
 * `teams|organizations/{id}.performance_indicators`.
 */
export interface PerformanceIndicator {
  key: string
  label: string
}

/**
 * The five default dimensions.
 *
 * These are the axes the profile heuristic below is built around, and the only
 * set for which it can name a profile — see `detectPerformanceProfile`. A team
 * that replaces them still gets a weakest/strongest axis (that calculation is
 * generic) but no named profile, which is the honest outcome rather than a
 * silently wrong one.
 */
export const DEFAULT_COACHING_DIMENSIONS: readonly PerformanceIndicator[] = [
  { key: 'consistency', label: 'Consistency' },
  { key: 'effort', label: 'Effort' },
  { key: 'focus', label: 'Focus' },
  { key: 'recharge', label: 'Recharge' },
  { key: 'sense_of_progress', label: 'Sense of progress' },
]

/** The canonical axis keys, in the order the heuristic reasons about them. */
export const CANONICAL_DIMENSION_KEYS = [
  'consistency',
  'effort',
  'focus',
  'recharge',
  'sense_of_progress',
] as const

/**
 * The dimensions this tenant actually uses.
 *
 * ONE resolver, run identically by the admin tab, the member surfaces and the
 * functions — the same shape `resolveBookingContactFields` follows. An empty or
 * absent list means "never configured", which falls back to the defaults; a
 * team that genuinely wants none is not a case worth modelling, since a goal
 * with no dimension is simply a goal with no chips.
 */
export function resolveCoachingDimensions(
  source: { performance_indicators?: PerformanceIndicator[] | null } | null | undefined,
): PerformanceIndicator[] {
  const configured = source?.performance_indicators
  if (!configured || configured.length === 0) return [...DEFAULT_COACHING_DIMENSIONS]
  return configured.filter((d) => typeof d?.key === 'string' && d.key.length > 0)
}

/** Display label for a dimension key, falling back to the raw key so a legacy
 *  value (`technique`, `attitude`, …) still renders as itself rather than
 *  vanishing from a goal that was tagged before the vocabularies merged. */
export function dimensionLabel(key: string, dimensions: PerformanceIndicator[]): string {
  return dimensions.find((d) => d.key === key)?.label ?? key
}

// ─── goals and steps ─────────────────────────────────────────────────────────

export interface Goal {
  id: string
  type: GoalType           // 'goal' = long-term with evaluations; 'task' = boolean homework
  title: string
  description?: string | null
  status: GoalStatus
  categories: string[]     // dimension keys — see resolveCoachingDimensions
  created_by: GoalCreatedBy
  created_at: Timestamp
  target_date?: Timestamp | null
  completed_at?: Timestamp | null  // set when task is marked done (status → 'achieved')

  /**
   * The goal this step serves, for `type: 'task'`.
   *
   * Null / absent = unparented, which the UI groups under a VIRTUAL "General"
   * heading. Deliberately not a real document: a placeholder goal would need
   * creating on first use, hiding when empty, and cleaning up when the last
   * step leaves it — three lifecycle problems bought for nothing.
   *
   * Always null on `type: 'goal'`. Goals do not nest.
   */
  parent_goal_id?: string | null

  /**
   * Denormalized from the newest evaluation, written ONLY by the `onGoalWrite`
   * trigger. They exist so a collapsed goal card can show how the goal is
   * actually going — before this, finding the one stale goal in a list meant
   * expanding every card to fetch its evaluations.
   */
  latest_score?: number | null
  last_evaluated_at?: Timestamp | null

  /**
   * When this goal was first observed past its `target_date`, stamped by the
   * daily job.
   *
   * A GOAL GOING OVERDUE INVOLVES NO WRITE — the date does not move, the clock
   * does — so nothing would otherwise wake the trigger that maintains the
   * contact's counters. Stamping here is that wake-up, and it keeps the counter
   * single-writer: the daily job touches the goal, `onGoalWrite` recomputes.
   * Cleared when the goal is completed, abandoned, or given a new target date.
   */
  overdue_at?: Timestamp | null
}

export interface GoalEvaluation {
  id: string
  evaluated_at: Timestamp
  evaluated_by: GoalCreatedBy
  score: number            // 1–5
  notes?: string | null
  status_after: GoalStatus
  edited?: boolean
}

/** Still open, and past its target date. Derived — `overdue_at` is the stored
 *  stamp that drives the counters, this is what a UI asks. */
export function goalIsOverdue(goal: Pick<Goal, 'status' | 'target_date'>, nowMs = Date.now()): boolean {
  if (goal.status === 'achieved' || goal.status === 'abandoned') return false
  const due = toMillis(goal.target_date)
  return due !== null && due < nowMs
}

/**
 * Goals with their steps nested, plus the virtual "General" bucket.
 *
 * Shared because three surfaces group the same way (admin tab, member Space,
 * mobile) and three copies of the parent/orphan rule is how they would start
 * disagreeing about where an unparented step belongs. A step whose parent is
 * missing — deleted goal, partial fetch — falls back to General rather than
 * disappearing.
 */
export function groupGoalsWithSteps(goals: Goal[]): {
  goals: { goal: Goal; steps: Goal[] }[]
  generalSteps: Goal[]
} {
  const parents = goals.filter((g) => g.type !== 'task')
  const steps = goals.filter((g) => g.type === 'task')
  const known = new Set(parents.map((g) => g.id))
  const byParent = new Map<string, Goal[]>()
  const generalSteps: Goal[] = []
  for (const s of steps) {
    const pid = s.parent_goal_id
    if (pid && known.has(pid)) {
      const list = byParent.get(pid)
      if (list) list.push(s)
      else byParent.set(pid, [s])
    } else {
      generalSteps.push(s)
    }
  }
  return {
    goals: parents.map((goal) => ({ goal, steps: byParent.get(goal.id) ?? [] })),
    generalSteps,
  }
}

// ─── performance check-ins ───────────────────────────────────────────────────

/** Who the check-in is about the relationship with: a private self-rating, or
 *  one taken together in a 1:1. */
export type PerformanceContext = 'self' | '1to1'

/** A named pattern the heuristic recognises. `default` = no pattern matched,
 *  which is a normal outcome and not an error. */
export type ProfileKey =
  | 'burnout_risk'
  | 'overreaching'
  | 'stuck'
  | 'coasting'
  | 'inconsistent'
  | 'balanced'
  | 'default'

export interface PerformanceCheckin {
  id: string
  taken_at: Timestamp
  filled_by: GoalCreatedBy
  /** dimension key → 1–5 */
  scores: Record<string, number>
  notes?: string | null
  context: PerformanceContext
  /** Absent when the team's dimensions are not the canonical five — see
   *  `detectPerformanceProfile`. */
  profile_key?: ProfileKey | null
  /** Weakest and strongest dimension keys. Generic: computed for ANY dimension
   *  set, which is what makes the "work on your weakest axis" prompt survive a
   *  team customising its vocabulary. */
  primary_lever?: string | null
  anchor?: string | null
}

export interface ProfileResult {
  profile_key: ProfileKey | null
  primary_lever: string | null
  anchor: string | null
}

/**
 * The ONE copy of the profile heuristic.
 *
 * It used to exist twice — `apps/mobile/src/utils/performanceProfile.ts` and an
 * inline function in the admin contact page — with the web copy typing
 * `profile_key` as a bare string. Thresholds are unchanged from those copies;
 * what is new is the honesty about custom vocabularies.
 *
 * `primary_lever` / `anchor` are computed from whatever keys the check-in
 * actually carries, so they work for any dimension set. `profile_key` is
 * returned ONLY when all five canonical axes are present: the rules below are
 * statements about consistency, effort, focus, recharge and sense of progress
 * specifically, and running them against a team's own axes would default every
 * missing one to 3 and report a confidently wrong profile.
 *
 * Rules are checked top-to-bottom; first match wins.
 */
export function detectPerformanceProfile(scores: Record<string, number>): ProfileResult {
  const entries = Object.entries(scores ?? {}).filter(([, v]) => typeof v === 'number')
  const sorted = [...entries].sort(([, a], [, b]) => a - b)
  const primary_lever = sorted.length > 0 ? sorted[0][0] : null
  const anchor = sorted.length > 0 ? sorted[sorted.length - 1][0] : null

  const canonical = CANONICAL_DIMENSION_KEYS.every((k) => typeof scores?.[k] === 'number')
  if (!canonical) return { profile_key: null, primary_lever, anchor }

  const C = scores['consistency']
  const E = scores['effort']
  const F = scores['focus']
  const R = scores['recharge']
  const P = scores['sense_of_progress']

  let profile_key: ProfileKey
  if (C >= 3.5 && E <= 2.5 && F <= 2.5 && P <= 2.5) profile_key = 'burnout_risk'
  else if (E >= 4 && R <= 2) profile_key = 'overreaching'
  else if (C >= 3.5 && E >= 3.5 && P <= 2) profile_key = 'stuck'
  else if (C >= 3.5 && E >= 3.5 && F <= 2.5) profile_key = 'coasting'
  else if (C <= 2.5 && (E + F + P) / 3 >= 3) profile_key = 'inconsistent'
  else if (C >= 3.5 && E >= 3.5 && F >= 3.5 && R >= 3.5 && P >= 3.5) profile_key = 'balanced'
  else profile_key = 'default'

  return { profile_key, primary_lever, anchor }
}

// ─── internal ────────────────────────────────────────────────────────────────

function toMillis(ts: Timestamp | null | undefined): number | null {
  if (!ts) return null
  const v = ts as unknown
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    const d = (v as { toDate(): Date }).toDate()
    return d instanceof Date ? d.getTime() : null
  }
  if (typeof v === 'object' && v !== null && 'seconds' in v) {
    return (v as { seconds: number }).seconds * 1000
  }
  if (typeof v === 'number') return v
  return null
}
