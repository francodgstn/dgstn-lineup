import { RANKING_HMD } from '../config'

export function transformContact(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  // Field renames
  if ('residence' in out) { out.address = out.residence; delete out.residence }
  delete out.teacher   // now derived from teamId
  delete out.notes     // old Lexical JSON is stale; new app handles notes differently
  delete out.acquisition  // lead funnel data — not needed

  // rank → ranks map
  if (out.rank != null) {
    out.ranks = { [RANKING_HMD]: out.rank }
  }
  delete out.rank

  // New required fields with safe defaults
  out.tags          = out.tags          ?? []
  out.anonymized_at = out.anonymized_at ?? null

  return out
}
