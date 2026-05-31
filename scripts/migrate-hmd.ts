/**
 * HMD → Lineup SaaS data migration
 *
 * See scripts/MIGRATE-HMD.md for full instructions.
 *
 * Usage:
 *   pnpm migrate:hmd --source-creds <path> --target-creds <path> [options]
 *   pnpm migrate:hmd --source-creds <path> --target-emulator       [options]
 *
 * Options:
 *   --org-admin-email <email>  Email of the user who becomes org creator + org_admin (default: franco.dgstn@gmail.com)
 *   --dry-run                  Log writes without committing
 *   --only <pass>              Run a single pass (see pass names below)
 *   --from-team <teamId>       Resume contacts/sessions from a specific team
 *   --verify                   Run verification after migration
 *
 * Passes: setup | users | teams | activities | session-series | contacts | sessions | events | referrals | team-subcollections | verify
 */

import { parseArgs } from 'node:util'
import { initApps } from './migration/config'
import type { MigrationConfig } from './migration/config'
import { pass00Setup }              from './migration/passes/00-setup'
import { pass01Users }              from './migration/passes/01-users'
import { pass02Teams }              from './migration/passes/02-teams'
import { pass03Activities }         from './migration/passes/03-activities'
import { pass04SessionSeries }      from './migration/passes/04-session-series'
import { pass05Contacts }           from './migration/passes/05-contacts'
import { pass06Sessions }           from './migration/passes/06-sessions'
import { pass08Events }             from './migration/passes/08-events'
import { pass10Referrals }          from './migration/passes/10-referrals'
import { pass11TeamSubcollections } from './migration/passes/11-team-subcollections'
import { verify }                   from './migration/verify'

const DEFAULT_ORG_ADMIN_EMAIL = 'franco.dgstn@gmail.com'

const { values } = parseArgs({
  options: {
    'source-creds':    { type: 'string' },
    'target-creds':    { type: 'string' },
    'target-emulator': { type: 'boolean', default: false },
    'org-admin-email': { type: 'string', default: DEFAULT_ORG_ADMIN_EMAIL },
    'dry-run':         { type: 'boolean', default: false },
    'only':            { type: 'string' },
    'from-team':       { type: 'string' },
    'verify':          { type: 'boolean', default: false },
  },
  allowPositionals: false,
})

const targetEmulator = values['target-emulator'] ?? false

if (!values['source-creds']) {
  console.error('Error: --source-creds is required')
  process.exit(1)
}
if (!targetEmulator && !values['target-creds']) {
  console.error('Error: provide --target-creds <path> or --target-emulator')
  process.exit(1)
}

const cfg: MigrationConfig = {
  sourceCredsPath: values['source-creds']!,
  targetCredsPath: values['target-creds'],
  targetEmulator,
  orgAdminEmail:   values['org-admin-email'] ?? DEFAULT_ORG_ADMIN_EMAIL,
  dryRun:          values['dry-run'] ?? false,
  only:            values['only'],
  fromTeam:        values['from-team'],
}

initApps(cfg)

if (cfg.dryRun) console.log('=== DRY RUN — no writes will be committed ===')
console.log(`Org admin: ${cfg.orgAdminEmail}`)

async function run() {
  const only = cfg.only

  if (!only || only === 'setup')               await pass00Setup(cfg)

  let teamIds: string[] = []
  if (!only || only === 'users')               await pass01Users(cfg)
  if (!only || only === 'teams')               teamIds = await pass02Teams(cfg)

  if (only && only !== 'teams' && teamIds.length === 0) {
    const { targetDb } = await import('./migration/config')
    const snap = await targetDb().collection('teams').get()
    teamIds = snap.docs.map((d) => d.id)
    console.log(`Loaded ${teamIds.length} teamIds from target for pass '${only}'`)
  }

  let activityMap = new Map<string, { name: string; type: string }>()
  if (!only || only === 'activities')          activityMap = await pass03Activities(cfg, teamIds)
  if (!only || only === 'session-series')      await pass04SessionSeries(cfg, teamIds)

  if (only === 'sessions' && activityMap.size === 0) {
    const { targetDb } = await import('./migration/config')
    const snap = await targetDb().collection('activities').get()
    for (const d of snap.docs) {
      activityMap.set(d.id, {
        name: String(d.data().name ?? ''),
        type: String(d.data().type ?? 'group_class'),
      })
    }
  }

  if (!only || only === 'contacts')            await pass05Contacts(cfg, teamIds)
  if (!only || only === 'sessions')            await pass06Sessions(cfg, teamIds, activityMap)
  if (!only || only === 'events')              await pass08Events(cfg)
  if (!only || only === 'referrals')           await pass10Referrals(cfg)
  if (!only || only === 'team-subcollections') await pass11TeamSubcollections(cfg, teamIds)

  if (!only || only === 'verify' || values['verify']) await verify(teamIds)

  console.log('\nMigration complete.')
}

run().catch((e) => { console.error(e); process.exit(1) })
