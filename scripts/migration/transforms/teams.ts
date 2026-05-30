import type { Timestamp } from 'firebase-admin/firestore'
import type { TeamConfig } from '../config'
import { ORG_ID, RANKING_SYSTEM_IDS } from '../config'

export function transformTeam(
  data: Record<string, unknown>,
  cfg: TeamConfig,
): Record<string, unknown> {
  return {
    ...data,
    // SaaS fields — not in hmd-lineup
    organizationId:    ORG_ID,
    plan:              'club',
    plan_status:       'active',
    trial_ends_at:     null,
    stripe_customer_id: null,
    // Per-club overrides
    language:          cfg.language,
    sport_type:        cfg.sport_type ?? data.sport_type ?? 'Martial arts',
    // Ranking systems — keyed by the IDs used in contacts.ranks
    ranking_systems: [
      {
        id:         RANKING_SYSTEM_IDS.hmd,
        name:       'Hwal Moo Do',
        is_primary: true,
        levels: [
          { value: 0, label: '10. Kup', color: '#ffffff' },
          { value: 1, label: '9. Kup',  color: '#f5f5f5' },
          { value: 2, label: '8. Kup',  color: '#fbbf24' },
          { value: 3, label: '7. Kup',  color: '#fbbf24' },
          { value: 4, label: '6. Kup',  color: '#f97316' },
          { value: 5, label: '5. Kup',  color: '#f97316' },
          { value: 6, label: '4. Kup',  color: '#22c55e' },
          { value: 7, label: '3. Kup',  color: '#22c55e' },
          { value: 8, label: '2. Kup',  color: '#3b82f6' },
          { value: 9, label: '1. Kup',  color: '#3b82f6' },
          { value: 10, label: '1. Dan', color: '#111827' },
        ],
      },
      {
        id:         RANKING_SYSTEM_IDS.kd,
        name:       'Korean Dragon',
        is_primary: false,
        levels: [
          { value: 0, label: 'Beginner',     color: '#e5e7eb' },
          { value: 1, label: 'Intermediate', color: '#3b82f6' },
          { value: 2, label: 'Advanced',     color: '#7e22ce' },
          { value: 3, label: 'Expert',       color: '#111827' },
        ],
      },
    ],
  }
}

export function buildSaasSubscription(teamId: string, now: Timestamp): Record<string, unknown> {
  return {
    teamId,
    plan:                  'club',
    status:                'active',
    trial_ends_at:         null,
    current_period_start:  null,
    current_period_end:    null,
    cancel_at_period_end:  false,
    gateway_type:          null,
    gateway_data:          null,
    created_at:            now,
    updated_at:            now,
  }
}
