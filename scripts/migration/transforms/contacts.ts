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

  return out
}
