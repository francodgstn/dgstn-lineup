import { ORG_ID } from '../config'

export function transformTeam(id: string, src: Record<string, unknown>): Record<string, unknown> {
  return {
    ...src,
    // SaaS fields — conservative defaults; adjust after billing setup
    plan: 'club',
    plan_status: 'active',
    trial_ends_at: null,
    stripe_customer_id: null,
    // Organisation link
    organizationId: ORG_ID,
    org_id: ORG_ID,
    // Defaults for new required fields
    sport_type: src.sport_type ?? 'Martial arts',
    language: src.language ?? 'de',
  }
}
