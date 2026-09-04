/**
 * HMD → Linyup SaaS data migration
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
 *   --overwrite                Re-apply current transforms to docs that already exist on the
 *                              target (default: skip them). Needed whenever a transform has
 *                              changed since the target was last migrated — see MIGRATE-HMD.md.
 *   --only <pass>                 Run a single pass (see pass names below)
 *   --from-team <teamId>          Resume contacts/sessions from a specific team
 *   --verify                      Run verification after migration
 *
 * Passes: setup | auth-users | users | teams | activities | session-series | contacts | sessions | events | exam-checkins | event-categories | referrals | team-subcollections | places | verify
 */

import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { getApp } from 'firebase-admin/app'
import { initApps, assertTargetEmulatorReachable, DEFAULT_ORG_ADMIN_EMAIL } from './migration/config'
import type { MigrationConfig } from './migration/config'
import { pass00Setup }              from './migration/passes/00-setup'
import { pass00AuthUsers }          from './migration/passes/00-auth-users'
import { pass01Users }              from './migration/passes/01-users'
import { pass02Teams }              from './migration/passes/02-teams'
import { pass03Activities }         from './migration/passes/03-activities'
import { pass04SessionSeries }      from './migration/passes/04-session-series'
import { pass05Contacts }           from './migration/passes/05-contacts'
import { pass06Sessions }           from './migration/passes/06-sessions'
import { pass08Events }             from './migration/passes/08-events'
import { pass09ExamCheckins }       from './migration/passes/09-exam-checkins'
import { pass09CupCheckins }        from './migration/passes/09-cup-checkins'
import { pass09EventCategories }    from './migration/passes/09-event-categories'
import { pass10Referrals }          from './migration/passes/10-referrals'
import { pass11TeamSubcollections } from './migration/passes/11-team-subcollections'
import { pass12Places }             from './migration/passes/12-places'
import { pass13OrgWebsite }         from './migration/passes/13-org-website'
import { pass14SeasonCalendar }     from './migration/passes/14-season-calendar'
import { verify }                   from './migration/verify'

const { values } = parseArgs({
  options: {
    'source-creds':    { type: 'string' },
    'target-creds':    { type: 'string' },
    'target-emulator': { type: 'boolean', default: false },
    'org-admin-email': { type: 'string', default: DEFAULT_ORG_ADMIN_EMAIL },
    'dry-run':         { type: 'boolean', default: false },
    'overwrite':       { type: 'boolean', default: false },
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
  overwrite:       values['overwrite'] ?? false,
  only:            values['only'],
  fromTeam:        values['from-team'],
}

async function enableEmailPasswordSignIn(): Promise<void> {
  if (cfg.targetEmulator) return
  if (cfg.dryRun) { console.log('[dry-run] would enable email/password sign-in'); return }
  const sa = JSON.parse(readFileSync(cfg.targetCredsPath!, 'utf-8')) as { project_id: string }
  const projectId = sa.project_id
  const app = getApp('target')
  const credential = app.options.credential as { getAccessToken(): Promise<{ access_token: string }> }
  const token = await credential.getAccessToken()
  const url =
    `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/config` +
    `?updateMask=signIn.email.enabled,signIn.email.passwordRequired`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }),
  })
  if (!res.ok) throw new Error(`Failed to enable email/password sign-in: ${res.status} ${await res.text()}`)
  console.log('✓ Email/password sign-in enabled')
}

async function run() {
  // Fail fast if --target-emulator is set but the emulators aren't running —
  // before reading source creds or touching any data.
  if (cfg.targetEmulator) await assertTargetEmulatorReachable()

  initApps(cfg)
  if (cfg.dryRun) console.log('=== DRY RUN — no writes will be committed ===')
  if (cfg.overwrite) {
    console.log('=== OVERWRITE — existing target docs are re-written from the source ===')
    console.log('    App-side edits to migrated contacts/sessions/events/check-ins will be replaced.')
    console.log('    The org doc, the org admin team_members row and the org website are NOT touched.')
  }
  console.log(`Org admin: ${cfg.orgAdminEmail}`)

  await enableEmailPasswordSignIn()
  const only = cfg.only

  if (!only || only === 'setup')               await pass00Setup(cfg)
  if (!only || only === 'auth-users')          await pass00AuthUsers(cfg)

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
        type: String(d.data().type ?? 'class'),
      })
    }
  }

  if (!only || only === 'contacts')            await pass05Contacts(cfg, teamIds)
  if (!only || only === 'sessions')            await pass06Sessions(cfg, teamIds, activityMap)
  if (!only || only === 'events')              await pass08Events(cfg)
  // Both read the check-ins pass08 has just written, so they follow it.
  if (!only || only === 'exam-checkins')       await pass09ExamCheckins(cfg)
  if (!only || only === 'cup-checkins')        await pass09CupCheckins(cfg)
  if (!only || only === 'event-categories')    await pass09EventCategories(cfg)
  if (!only || only === 'referrals')           await pass10Referrals(cfg)
  if (!only || only === 'team-subcollections') await pass11TeamSubcollections(cfg, teamIds)
  if (!only || only === 'places')              await pass12Places(cfg, teamIds)
  if (!only || only === 'org-website')         await pass13OrgWebsite(cfg)
  if (!only || only === 'season-calendar')     await pass14SeasonCalendar(cfg)

  if (!only || only === 'verify' || values['verify']) await verify(teamIds)

  console.log('\nMigration complete.')
}

run().catch((e) => { console.error(e); process.exit(1) })
