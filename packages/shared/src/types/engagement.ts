// ─── Engagement band ──────────────────────────────────────────────────────────
// A read-only signal of how engaged a contact is, derived ON RENDER from their
// attendance recency (days since last attended session) measured against the
// studio's configurable thresholds. It is NEVER stored on the contact — always
// computed — so it can't drift and there's nothing to edit manually.

export type EngagementBand = 'active' | 'low' | 'at_risk' | 'inactive'

export const ENGAGEMENT_BANDS: EngagementBand[] = ['active', 'low', 'at_risk', 'inactive']

// Day thresholds, measured from the contact's last attended session (falling back
// to their join date when they've never attended). Each value is the inclusive
// upper bound for that band; beyond `at_risk_within_days` the contact is inactive.
// Invariant: active_within_days < low_within_days < at_risk_within_days.
export interface EngagementThresholds {
  active_within_days: number
  low_within_days: number
  at_risk_within_days: number
}

export const DEFAULT_ENGAGEMENT_THRESHOLDS: EngagementThresholds = {
  active_within_days: 14,
  low_within_days: 30,
  at_risk_within_days: 60,
}

/**
 * Derive a contact's engagement band from how many days have elapsed since their
 * last attended session. Pure + deterministic (pass `nowMs` in tests).
 *
 * @param lastActivityMs epoch ms of the reference point — typically
 *   `last_session_at`, falling back to `created_at`. `null` ⇒ no data ⇒ inactive.
 */
export function computeEngagementBand(
  lastActivityMs: number | null | undefined,
  thresholds: EngagementThresholds = DEFAULT_ENGAGEMENT_THRESHOLDS,
  nowMs: number = Date.now()
): EngagementBand {
  if (lastActivityMs == null) return 'inactive'
  const days = (nowMs - lastActivityMs) / 86_400_000
  if (days <= thresholds.active_within_days) return 'active'
  if (days <= thresholds.low_within_days) return 'low'
  if (days <= thresholds.at_risk_within_days) return 'at_risk'
  return 'inactive'
}
