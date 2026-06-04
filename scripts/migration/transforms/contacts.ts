import { RANKING_HMD, RANKING_KD } from '../config'

export function transformContact(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  // Field renames
  if ('residence' in out) { out.address = out.residence; delete out.residence }
  delete out.teacher      // now derived from teamId
  delete out.notes        // old Lexical JSON is stale; new app handles notes differently
  delete out.acquisition  // lead funnel data — not needed

  // Build ranks map from all available rank sources:
  //   - contact.rank            → primary HMD belt rank
  //   - contact.disciplines.hmd_rank / .kd_rank  → per-discipline ranks (newer hmd-lineup)
  const ranks: Record<string, number> = {}

  const disciplines = src.disciplines as Record<string, unknown> | undefined
  const hmdRank = disciplines?.hmd_rank ?? src.rank
  const kdRank  = disciplines?.kd_rank

  if (hmdRank != null) ranks[RANKING_HMD] = Number(hmdRank)
  if (kdRank  != null) ranks[RANKING_KD]  = Number(kdRank)

  if (Object.keys(ranks).length > 0) out.ranks = ranks
  delete out.rank
  delete out.disciplines  // replaced by ranks map above

  // New required fields with safe defaults
  out.tags          = out.tags          ?? []
  out.anonymized_at = out.anonymized_at ?? null
  // Ensure these fields always exist as null so Firestore equality queries work correctly
  out.deleted_at    = out.deleted_at    ?? null
  out.archived_at   = out.archived_at   ?? null

  // HMD tracked membership at the club level via membership_status/membership_active/membership_expiration.
  // In Linyup the membership relationship is contact↔org (the club is just the intermediary),
  // so these fields rename to the org_membership_* namespace.
  if ('membership_status' in out)     { out.org_membership_status     = out.membership_status;     delete out.membership_status }
  if ('membership_active' in out)     { out.org_membership_active     = out.membership_active;     delete out.membership_active }
  if ('membership_expiration' in out) { out.org_membership_expiration = out.membership_expiration; delete out.membership_expiration }

  // Coerce org_membership for soft-deleted contacts — HMD sometimes left status as 'active'
  // on contacts that were subsequently deleted, causing them to inflate active-member counts.
  if (out.deleted_at != null) {
    out.org_membership_status = 'expired'
    out.org_membership_active = false
  }

  return out
}
