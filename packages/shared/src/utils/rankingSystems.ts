import type { RankingSystem } from '../types/team'

/**
 * THE rule for which ranking systems apply to a team — the organisation's, or
 * its own.
 *
 * `Organization.ranking_systems` says "when set, overrides individual team
 * ranking_systems for all linked teams", and the load-bearing words are WHEN
 * SET. An organisation that has configured none has not thereby taken the
 * feature away from its studios; it has simply not used it.
 *
 * That distinction was lost in the one place this used to live: the hook
 * returned the org's list whenever an `org_id` existed, so a studio inside an
 * organisation with no systems of its own saw NONE — its own configuration
 * silently invisible. Every other caller then re-derived the rule inline, and
 * two skipped the organisation entirely, which is why an org-managed tenant's
 * dashboard belt breakdown came out blank.
 *
 * One function, so the client hook, the automation builder and the server-side
 * engine cannot disagree about which systems exist.
 */
export function effectiveRankingSystems(
  teamSystems: RankingSystem[] | undefined | null,
  orgSystems: RankingSystem[] | undefined | null,
): RankingSystem[] {
  if (orgSystems && orgSystems.length > 0) return orgSystems
  return teamSystems ?? []
}

/** True when the ORGANISATION owns the systems, so a team-level editor locks. */
export function rankingSystemsManagedByOrg(
  orgSystems: RankingSystem[] | undefined | null,
): boolean {
  return (orgSystems?.length ?? 0) > 0
}

/**
 * Is `systemId` one this tenant may actually write to?
 *
 * The membership check every writer of `Contact.ranks` owes: its keys are
 * otherwise arbitrary strings, and an unvalidated write puts a rank under a
 * system id nothing will ever render.
 */
export function isKnownRankingSystem(
  systems: RankingSystem[] | undefined | null,
  systemId: string,
): boolean {
  return (systems ?? []).some((s) => s.id === systemId)
}
