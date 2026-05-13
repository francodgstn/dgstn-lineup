import type { Contact, RankingSystem, RankLevel } from '@lineup/shared'

export function getPrimaryRank(
  contact: Contact,
  systems: RankingSystem[],
): { system: RankingSystem; level: RankLevel } | null {
  const ranks = contact.ranks ?? {}
  if (!systems.length || !Object.keys(ranks).length) return null

  const primary = systems.find((s) => s.is_primary)
  const systemId = primary?.id
    ?? Object.entries(ranks).sort(([, a], [, b]) => b - a)[0]?.[0]

  if (!systemId) return null
  const system = systems.find((s) => s.id === systemId)
  if (!system) return null

  const value = ranks[systemId]
  if (value === undefined) return null

  const level = system.levels.find((l) => l.value === value)
    ?? system.levels.slice().sort((a, b) => b.value - a.value).find((l) => l.value <= value)
  if (!level) return null

  return { system, level }
}
