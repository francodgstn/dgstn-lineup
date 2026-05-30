/**
 * Migration configuration for hmd-lineup → dgstn-lineup.
 *
 * Before running the migration:
 * 1. Fill in SOURCE_PROJECT_ID and TARGET_PROJECT_ID.
 * 2. Add all 16 HMD team IDs to TEAM_CONFIGS with per-team language.
 * 3. Confirm RANKING_SYSTEM_IDS match the ranking_systems entries you want on team docs.
 */

export const SOURCE_PROJECT_ID = 'hmd-lineup'
export const TARGET_PROJECT_ID = 'lineup-staging' // switch to 'lineup-prod' for production run

/** The org doc created in Phase 0. */
export const ORG_ID = 'hmd'

/** Ranking system IDs — used as keys in contacts.ranks and in teams.ranking_systems[].id */
export const RANKING_SYSTEM_IDS = {
  hmd: 'hmd', // Hwal Moo Do — disciplines.hmd_rank
  kd:  'kd',  // Korean Dragon — disciplines.kd_rank
} as const

export interface TeamConfig {
  /** Team document ID in hmd-lineup (same ID reused in dgstn-lineup). */
  id: string
  /** Portal language for this club. */
  language: 'de' | 'fr' | 'it' | 'en'
  /** Sport type label — defaults to 'Martial arts' if omitted. */
  sport_type?: string
}

/**
 * Fill this list with the 16 actual team IDs from hmd-lineup.
 * Read them with: firebase --project hmd-lineup firestore:export or admin SDK.
 * Example entry: { id: 'team-zurich-north', language: 'de' }
 */
export const TEAM_CONFIGS: TeamConfig[] = [
  // TODO: populate with actual team IDs before running migration
  // { id: 'team-abc123', language: 'de' },
]

if (TEAM_CONFIGS.length === 0) {
  console.warn('[config] WARNING: TEAM_CONFIGS is empty — populate before running migration.')
}
