// The partner-app names for a team's public_profile mirror, computed from its
// subscription-type definitions. Mirrors `resolveTeamPartnerApps`
// (packages/functions/src/sync/syncTeamPublicProfile.ts) EXACTLY — aggregator
// types only, `active === false` dropped, blank names dropped, deduped
// case-insensitively, and SORTED by localeCompare.
//
// The seeders write the public_profile mirror DIRECTLY (rather than through the
// sync trigger), so a mirror that disagrees with what the trigger would produce
// is a seed that lies about the tenant. This lifts three identical hand-copies
// into one — the copies all LACKED the sort, so a seeded mirror could differ
// from a live-synced one only in order, which is the kind of drift nobody spots.
export function partnerAppNames(
  defs: { source?: string; active?: boolean; name?: string }[]
): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const d of defs) {
    if (d.source !== 'aggregator') continue
    if (d.active === false) continue
    const name = typeof d.name === 'string' ? d.name.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names.sort((a, b) => a.localeCompare(b))
}
