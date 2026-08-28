// Manual mirror of parts of packages/shared/src/types/goal.ts.
//
// apps/mobile does not depend on @linyup/shared — see the RankingSystem note
// in ../types/index.ts: wiring the workspace package in needs a Metro/
// monorepo module-resolution change of its own, not a bug fix, so this file
// hand-copies the functions mobile needs from the shared coaching contract.
// Keep the logic byte-for-byte equivalent to the shared source — if it drifts,
// fix it there and re-copy, don't "improve" it here.
//
// Replaces the old apps/mobile/src/utils/performanceProfile.ts, which had
// drifted from shared: it defaulted every missing axis to 3 and always named
// a profile, even for a team whose dimensions aren't the canonical five.

import { Goal, PerformanceIndicator, ProfileKey } from '../types';

/** The canonical axis keys, in the order the heuristic reasons about them. */
export const CANONICAL_DIMENSION_KEYS = [
  'consistency',
  'effort',
  'focus',
  'recharge',
  'sense_of_progress',
] as const;

/**
 * The five default coaching dimensions.
 *
 * Used BOTH as goal categories and as performance check-in axes — they are
 * ONE team-configurable list, not two (see `resolveCoachingDimensions`).
 * These are also the only axes the profile heuristic below can name a
 * profile for; a team that replaces them still gets a weakest/strongest axis
 * (generic) but no named profile.
 */
export const DEFAULT_COACHING_DIMENSIONS: readonly PerformanceIndicator[] = [
  { key: 'consistency', label: 'Consistency' },
  { key: 'effort', label: 'Effort' },
  { key: 'focus', label: 'Focus' },
  { key: 'recharge', label: 'Recharge' },
  { key: 'sense_of_progress', label: 'Sense of progress' },
];

/**
 * The dimensions this tenant actually uses. An empty or absent configured
 * list means "never configured", which falls back to the defaults.
 */
export function resolveCoachingDimensions(
  source: { performance_indicators?: PerformanceIndicator[] | null } | null | undefined,
): PerformanceIndicator[] {
  const configured = source?.performance_indicators;
  if (!configured || configured.length === 0) return [...DEFAULT_COACHING_DIMENSIONS];
  return configured.filter((d) => typeof d?.key === 'string' && d.key.length > 0);
}

export interface ProfileResult {
  profile_key: ProfileKey | null;
  primary_lever: string | null;
  anchor: string | null;
}

/**
 * `primary_lever` / `anchor` are computed from whatever keys the check-in
 * actually carries, so they work for any dimension set. `profile_key` is
 * returned ONLY when all five canonical axes are present: the rules below are
 * statements about consistency, effort, focus, recharge and sense of progress
 * specifically, and running them against a team's own axes would default
 * every missing one to 3 and report a confidently wrong profile.
 *
 * Rules are checked top-to-bottom; first match wins.
 */
export function detectPerformanceProfile(scores: Record<string, number>): ProfileResult {
  const entries = Object.entries(scores ?? {}).filter(([, v]) => typeof v === 'number');
  const sorted = [...entries].sort(([, a], [, b]) => a - b);
  const primary_lever = sorted.length > 0 ? sorted[0][0] : null;
  const anchor = sorted.length > 0 ? sorted[sorted.length - 1][0] : null;

  const canonical = CANONICAL_DIMENSION_KEYS.every((k) => typeof scores?.[k] === 'number');
  if (!canonical) return { profile_key: null, primary_lever, anchor };

  const C = scores['consistency'];
  const E = scores['effort'];
  const F = scores['focus'];
  const R = scores['recharge'];
  const P = scores['sense_of_progress'];

  let profile_key: ProfileKey;
  if (C >= 3.5 && E <= 2.5 && F <= 2.5 && P <= 2.5) profile_key = 'burnout_risk';
  else if (E >= 4 && R <= 2) profile_key = 'overreaching';
  else if (C >= 3.5 && E >= 3.5 && P <= 2) profile_key = 'stuck';
  else if (C >= 3.5 && E >= 3.5 && F <= 2.5) profile_key = 'coasting';
  else if (C <= 2.5 && (E + F + P) / 3 >= 3) profile_key = 'inconsistent';
  else if (C >= 3.5 && E >= 3.5 && F >= 3.5 && R >= 3.5 && P >= 3.5) profile_key = 'balanced';
  else profile_key = 'default';

  return { profile_key, primary_lever, anchor };
}

/**
 * Goals with their steps nested, plus the virtual "General" bucket.
 *
 * A step whose parent is missing (deleted goal, partial fetch) or absent
 * falls back to General rather than disappearing. Mirrors the same grouping
 * the admin tab and the member Space use, so the three surfaces agree on
 * where an unparented step belongs.
 */
export function groupGoalsWithSteps(goals: Goal[]): {
  goals: { goal: Goal; steps: Goal[] }[]
  generalSteps: Goal[]
} {
  const parents = goals.filter((g) => g.type !== 'task');
  const steps = goals.filter((g) => g.type === 'task');
  const known = new Set(parents.map((g) => g.id));
  const byParent = new Map<string, Goal[]>();
  const generalSteps: Goal[] = [];
  for (const s of steps) {
    const pid = s.parent_goal_id;
    if (pid && known.has(pid)) {
      const list = byParent.get(pid);
      if (list) list.push(s);
      else byParent.set(pid, [s]);
    } else {
      generalSteps.push(s);
    }
  }
  return {
    goals: parents.map((goal) => ({ goal, steps: byParent.get(goal.id) ?? [] })),
    generalSteps,
  };
}
