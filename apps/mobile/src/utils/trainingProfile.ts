import { ProfileKey } from '../types';

export interface ProfileResult {
  profile_key: ProfileKey;
  primary_lever: string;
  anchor: string;
}

const AXIS_KEYS = ['consistency', 'effort', 'focus', 'recharge', 'sense_of_progress'] as const;

/**
 * Detects the training profile from a set of axis scores (1–5).
 * Rules are checked top-to-bottom; first match wins.
 */
export function detectTrainingProfile(scores: Record<string, number>): ProfileResult {
  const C = scores['consistency'] ?? 3;
  const E = scores['effort'] ?? 3;
  const F = scores['focus'] ?? 3;
  const R = scores['recharge'] ?? 3;
  const P = scores['sense_of_progress'] ?? 3;

  const axisEntries = AXIS_KEYS.map(k => [k, scores[k] ?? 3] as [string, number]);
  const sorted = [...axisEntries].sort(([, a], [, b]) => a - b);
  const primary_lever = sorted[0][0];
  const anchor = sorted[sorted.length - 1][0];

  let profile_key: ProfileKey;

  if (C >= 3.5 && E <= 2.5 && F <= 2.5 && P <= 2.5) {
    profile_key = 'burnout_risk';
  } else if (E >= 4 && R <= 2) {
    profile_key = 'overreaching';
  } else if (C >= 3.5 && E >= 3.5 && P <= 2) {
    profile_key = 'stuck';
  } else if (C >= 3.5 && E >= 3.5 && F <= 2.5) {
    profile_key = 'coasting';
  } else if (C <= 2.5 && (E + F + P) / 3 >= 3) {
    profile_key = 'inconsistent';
  } else if (C >= 3.5 && E >= 3.5 && F >= 3.5 && R >= 3.5 && P >= 3.5) {
    profile_key = 'balanced';
  } else {
    profile_key = 'default';
  }

  return { profile_key, primary_lever, anchor };
}
