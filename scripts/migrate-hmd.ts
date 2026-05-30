/**
 * HMD → Lineup SaaS data migration script.
 * See scripts/migration/README.md for full usage instructions.
 *
 * Usage:
 *   tsx scripts/migrate-hmd.ts \
 *     --source-creds ./keys/hmd-prod-sa.json \
 *     --target-creds ./keys/lineup-staging-sa.json \
 *     [--dry-run] [--only <pass>] [--from-team <teamId>] [--setup]
 */

import { initializeApp, cert, type App } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import path from 'path'

import { TEAM_CONFIGS, ORG_ID, SOURCE_PROJECT_ID, TARGET_PROJECT_ID } from './migration/config'
import { AutoBatch } from './migration/batch'
import { transformTeam, buildSaasSubscription } from './migration/transforms/teams'
import { transformActivity } from './migration/transforms/activities'
import { transformContact, transformContactAlert } from './migration/transforms/contacts'
import {
  transformSession,
  transformParticipant,
  transformBooking,
  transformSessionSeries,
} from './migration/transforms/sessions'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : undefined
}

function hasFlag(name: string): boolean {
  return args.includes(name)
}

const DRY_RUN     = hasFlag('--dry-run')
const ONLY_PASS   = flag('--only')
const FROM_TEAM   = flag('--from-team')
const SETUP_ONLY  = hasFlag('--setup')

const sourceCredsPath = flag('--source-creds')
const targetCredsPath = flag('--target-creds')

if (!sourceCredsPath || !targetCredsPath) {
  console.error('Usage: tsx scripts/migrate-hmd.ts --source-creds <path> --target-creds <path> [--dry-run] [--only <pass>] [--from-team <teamId>] [--setup]')
  process.exit(1)
}

// ── Firebase init ─────────────────────────────────────────────────────────────

function initDb(credsPath: string, name: string): { app: App; db: Firestore } {
  const creds = JSON.parse(readFileSync(path.resolve(credsPath), 'utf8'))
  const app   = initializeApp({ credential: cert(creds) }, name)
  const db    = getFirestore(app)
  return { app, db }
}

const { db: srcDb } = initDb(sourceCredsPath, 'source')
const { db: tgtDb } = initDb(targetCredsPath, 'target')

// ── Status tracking (resumable) ───────────────────────────────────────────────

const STATUS_DOC = '_migration/hmd'

async function getStatus(): Promise<Record<string, boolean>> {
  const snap = await tgtDb.doc(STATUS_DOC).get()
  return (snap.data() ?? {}) as Record<string, boolean>
}

async function markPassDone(pass: string): Promise<void> {
  if (!DRY_RUN) {
    await tgtDb.doc(STATUS_DOC).set({ [pass]: true }, { merge: true })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[${DRY_RUN ? 'DRY' : 'RUN'}] ${msg}`) }

async function countCollection(db: Firestore, col: string): Promise<number> {
  const snap = await db.collection(col).count().get()
  return snap.data().count
}

async function getAllDocs(db: Firestore, col: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snap = await db.collection(col).get()
  return snap.docs
}

function shouldSkip(status: Record<string, boolean>, pass: string): boolean {
  if (ONLY_PASS && ONLY_PASS !== pass) return true
  if (status[pass]) {
    log(`Skipping pass "${pass}" — already completed.`)
    return true
  }
  return false
}

// ── Phase 0: Setup (--setup flag) ─────────────────────────────────────────────

async function setupOrg(): Promise<void> {
  log(`Creating organizations/${ORG_ID}…`)
  const orgRef = tgtDb.collection('organizations').doc(ORG_ID)
  const existing = await orgRef.get()
  if (existing.exists) {
    log(`organizations/${ORG_ID} already exists — skipping.`)
    return
  }
  if (!DRY_RUN) {
    await orgRef.set({
      name:      'HMD',
      slug:      'hmd',
      createdBy: 'migration',
      created:   Timestamp.now(),
    })
  }
  log(`Created organizations/${ORG_ID}.`)
}

// ── Pass 1: Users ─────────────────────────────────────────────────────────────

async function passUsers(status: Record<string, boolean>): Promise<void> {
  const pass = 'users'
  if (shouldSkip(status, pass)) return
  log('Pass 1: users…')

  const docs  = await getAllDocs(srcDb, 'users')
  const batch = new AutoBatch(tgtDb, DRY_RUN)
  let   count = 0

  for (const doc of docs) {
    const ref = tgtDb.collection('users').doc(doc.id)
    batch.set(ref, doc.data() as Record<string, unknown>)
    count++
    if (batch.needsFlush()) await batch.flush()
  }
  await batch.flush()

  log(`  users: ${count} docs written.`)
  await markPassDone(pass)
}

// ── Pass 2: Teams + saas_subscriptions ────────────────────────────────────────

async function passTeams(status: Record<string, boolean>): Promise<void> {
  const pass = 'teams'
  if (shouldSkip(status, pass)) return
  log('Pass 2: teams…')

  const now   = Timestamp.now()
  const batch = new AutoBatch(tgtDb, DRY_RUN)
  let   count = 0

  const teams = FROM_TEAM
    ? TEAM_CONFIGS.filter(t => t.id === FROM_TEAM)
    : TEAM_CONFIGS

  for (const cfg of teams) {
    const snap = await srcDb.collection('teams').doc(cfg.id).get()
    if (!snap.exists) {
      log(`  WARNING: teams/${cfg.id} not found in source — skipping.`)
      continue
    }

    const transformed = transformTeam(snap.data() as Record<string, unknown>, cfg)
    batch.set(tgtDb.collection('teams').doc(cfg.id), transformed)

    const saas = buildSaasSubscription(cfg.id, now as FirebaseFirestore.Timestamp)
    batch.set(tgtDb.collection('saas_subscriptions').doc(cfg.id), saas)

    count++
    if (batch.needsFlush()) await batch.flush()
  }
  await batch.flush()

  log(`  teams: ${count} team docs + ${count} saas_subscriptions written.`)
  await markPassDone(pass)
}

// ── Pass 3: Activities ────────────────────────────────────────────────────────

async function passActivities(status: Record<string, boolean>): Promise<void> {
  const pass = 'activities'
  if (shouldSkip(status, pass)) return
  log('Pass 3: activities…')

  const teamIds = (FROM_TEAM ? [FROM_TEAM] : TEAM_CONFIGS.map(t => t.id))
  const batch   = new AutoBatch(tgtDb, DRY_RUN)
  let   count   = 0

  for (const teamId of teamIds) {
    const docs = await srcDb.collection('activities').where('teamId', '==', teamId).get()
    for (const doc of docs.docs) {
      const transformed = transformActivity(doc.data() as Record<string, unknown>)
      batch.set(tgtDb.collection('activities').doc(doc.id), transformed)
      count++
      if (batch.needsFlush()) await batch.flush()
    }
  }
  await batch.flush()

  log(`  activities: ${count} docs written.`)
  await markPassDone(pass)
}

// ── Pass 4: Session series ────────────────────────────────────────────────────

async function passSessionSeries(status: Record<string, boolean>): Promise<void> {
  const pass = 'session_series'
  if (shouldSkip(status, pass)) return
  log('Pass 4: session_series…')

  const teamIds = (FROM_TEAM ? [FROM_TEAM] : TEAM_CONFIGS.map(t => t.id))
  const batch   = new AutoBatch(tgtDb, DRY_RUN)
  let   count   = 0

  for (const teamId of teamIds) {
    const docs = await srcDb.collection('session_series').where('teamId', '==', teamId).get()
    for (const doc of docs.docs) {
      const transformed = transformSessionSeries(doc.data() as Record<string, unknown>)
      batch.set(tgtDb.collection('session_series').doc(doc.id), transformed)
      count++
      if (batch.needsFlush()) await batch.flush()
    }
  }
  await batch.flush()

  log(`  session_series: ${count} docs written.`)
  await markPassDone(pass)
}

// ── Pass 5: Contacts + subcollections ─────────────────────────────────────────

const CONTACT_SUBCOLLECTIONS_COPY_AS_IS = [
  'subscription_history',
  'goals',            // includes nested evaluations — Firestore subcollections are NOT
                      // copied automatically; we recurse into them separately below
  'monthly_scores',
  'contact_weekly_reports',
  'training_checkins',
]

async function copyGoalEvaluations(srcContactRef: FirebaseFirestore.DocumentReference, tgtContactRef: FirebaseFirestore.DocumentReference, goalId: string, batch: AutoBatch): Promise<void> {
  const evals = await srcContactRef.collection('goals').doc(goalId).collection('evaluations').get()
  for (const e of evals.docs) {
    batch.set(
      tgtContactRef.collection('goals').doc(goalId).collection('evaluations').doc(e.id),
      e.data() as Record<string, unknown>,
    )
    if (batch.needsFlush()) await batch.flush()
  }
}

async function passContacts(status: Record<string, boolean>): Promise<void> {
  const pass = 'contacts'
  if (shouldSkip(status, pass)) return
  log('Pass 5: contacts + subcollections…')

  const teamIds = (FROM_TEAM ? [FROM_TEAM] : TEAM_CONFIGS.map(t => t.id))
  let   count   = 0

  for (const teamId of teamIds) {
    const docs  = await srcDb.collection('contacts').where('teamId', '==', teamId).get()
    const batch = new AutoBatch(tgtDb, DRY_RUN)

    for (const doc of docs.docs) {
      const transformed = transformContact(doc.data() as Record<string, unknown>)
      const tgtRef      = tgtDb.collection('contacts').doc(doc.id)
      const srcRef      = srcDb.collection('contacts').doc(doc.id)

      batch.set(tgtRef, transformed)
      count++
      if (batch.needsFlush()) await batch.flush()

      // --- subcollections ---

      // contact_alerts: flatten schedule
      const alerts = await srcRef.collection('contact_alerts').get()
      for (const a of alerts.docs) {
        batch.set(
          tgtRef.collection('contact_alerts').doc(a.id),
          transformContactAlert(a.data() as Record<string, unknown>),
        )
        if (batch.needsFlush()) await batch.flush()
      }

      // copy-as-is subcollections (except goals which need evaluation recursion)
      for (const sub of CONTACT_SUBCOLLECTIONS_COPY_AS_IS) {
        if (sub === 'goals') continue // handled below
        const subDocs = await srcRef.collection(sub).get()
        for (const s of subDocs.docs) {
          batch.set(
            tgtRef.collection(sub).doc(s.id),
            s.data() as Record<string, unknown>,
          )
          if (batch.needsFlush()) await batch.flush()
        }
      }

      // goals + nested evaluations
      const goals = await srcRef.collection('goals').get()
      for (const g of goals.docs) {
        batch.set(
          tgtRef.collection('goals').doc(g.id),
          g.data() as Record<string, unknown>,
        )
        if (batch.needsFlush()) await batch.flush()
        await copyGoalEvaluations(srcRef, tgtRef, g.id, batch)
      }
    }

    await batch.flush()
    log(`  contacts [${teamId}]: ${docs.size} contacts written.`)
  }

  log(`  contacts total: ${count} docs.`)
  await markPassDone(pass)
}

// ── Pass 6: Sessions + participants + bookings ────────────────────────────────

async function passSessions(status: Record<string, boolean>): Promise<void> {
  const pass = 'sessions'
  if (shouldSkip(status, pass)) return
  log('Pass 6: sessions + subcollections…')

  const teamIds = (FROM_TEAM ? [FROM_TEAM] : TEAM_CONFIGS.map(t => t.id))

  // Build activity lookup map for denormalization
  const activityMap = new Map<string, { name: string; type: string }>()
  for (const teamId of teamIds) {
    const acts = await tgtDb.collection('activities').where('teamId', '==', teamId).get()
    for (const a of acts.docs) {
      activityMap.set(a.id, {
        name: String(a.data().name ?? ''),
        type: String(a.data().type ?? 'group_class'),
      })
    }
  }

  let count = 0

  for (const teamId of teamIds) {
    const docs  = await srcDb.collection('sessions').where('teamId', '==', teamId).get()
    const batch = new AutoBatch(tgtDb, DRY_RUN)

    for (const doc of docs.docs) {
      const transformed = transformSession(doc.data() as Record<string, unknown>, activityMap)
      const tgtRef      = tgtDb.collection('sessions').doc(doc.id)
      const srcRef      = srcDb.collection('sessions').doc(doc.id)

      batch.set(tgtRef, transformed)
      count++
      if (batch.needsFlush()) await batch.flush()

      // participants
      const participants = await srcRef.collection('participants').get()
      for (const p of participants.docs) {
        batch.set(
          tgtRef.collection('participants').doc(p.id),
          transformParticipant(p.data() as Record<string, unknown>, p.id, teamId),
        )
        if (batch.needsFlush()) await batch.flush()
      }

      // bookings
      const bookings = await srcRef.collection('bookings').get()
      for (const b of bookings.docs) {
        batch.set(
          tgtRef.collection('bookings').doc(b.id),
          transformBooking(b.data() as Record<string, unknown>, b.id, doc.id, teamId),
        )
        if (batch.needsFlush()) await batch.flush()
      }
    }

    await batch.flush()
    log(`  sessions [${teamId}]: ${docs.size} sessions written.`)
  }

  log(`  sessions total: ${count} docs.`)
  await markPassDone(pass)
}

// ── Pass 7: Referrals ─────────────────────────────────────────────────────────

async function passReferrals(status: Record<string, boolean>): Promise<void> {
  const pass = 'referrals'
  if (shouldSkip(status, pass)) return
  log('Pass 7: referrals…')

  const teamIds = (FROM_TEAM ? [FROM_TEAM] : TEAM_CONFIGS.map(t => t.id))
  const batch   = new AutoBatch(tgtDb, DRY_RUN)
  let   count   = 0

  for (const teamId of teamIds) {
    const docs = await srcDb.collection('referrals').where('teamId', '==', teamId).get()
    for (const doc of docs.docs) {
      batch.set(tgtDb.collection('referrals').doc(doc.id), doc.data() as Record<string, unknown>)
      count++
      if (batch.needsFlush()) await batch.flush()
    }
  }
  await batch.flush()

  log(`  referrals: ${count} docs written.`)
  await markPassDone(pass)
}

// ── Pass 8: Team subcollections ────────────────────────────────────────────────

const TEAM_SUBCOLLECTIONS: string[] = [
  'subscription_types',
  'subscription_transitions',
  'outreach_templates',
  'automation_rules',
  'team_invitations',
  'contact_requests',
  'team_alerts',
  'alert_presets',
  'leaderboard',
  'activity_log',
  'team_weekly_reports',
]

async function passTeamSubcollections(status: Record<string, boolean>): Promise<void> {
  const pass = 'team_subcollections'
  if (shouldSkip(status, pass)) return
  log('Pass 8: team subcollections…')

  const teams = FROM_TEAM
    ? TEAM_CONFIGS.filter(t => t.id === FROM_TEAM)
    : TEAM_CONFIGS

  for (const cfg of teams) {
    const batch = new AutoBatch(tgtDb, DRY_RUN)
    let   count = 0

    for (const sub of TEAM_SUBCOLLECTIONS) {
      const docs = await srcDb.collection('teams').doc(cfg.id).collection(sub).get()
      for (const doc of docs.docs) {
        batch.set(
          tgtDb.collection('teams').doc(cfg.id).collection(sub).doc(doc.id),
          doc.data() as Record<string, unknown>,
        )
        count++
        if (batch.needsFlush()) await batch.flush()
      }
    }

    // Merge users/{id}/activity_log → teams/{teamId}/activity_log (prefix doc IDs)
    const userDocs = await srcDb.collection('users').where('currentTeam', '==', cfg.id).get()
    for (const userDoc of userDocs.docs) {
      const logs = await srcDb.collection('users').doc(userDoc.id).collection('activity_log').get()
      for (const l of logs.docs) {
        batch.set(
          tgtDb.collection('teams').doc(cfg.id).collection('activity_log').doc(`user_${l.id}`),
          l.data() as Record<string, unknown>,
        )
        count++
        if (batch.needsFlush()) await batch.flush()
      }

      // Merge users/{id}/user_weekly_reports → teams/{teamId}/team_weekly_reports
      const reports = await srcDb.collection('users').doc(userDoc.id).collection('user_weekly_reports').get()
      for (const r of reports.docs) {
        // Use a prefixed ID to avoid ISO week conflicts between users
        batch.set(
          tgtDb.collection('teams').doc(cfg.id).collection('team_weekly_reports').doc(`user_${userDoc.id}_${r.id}`),
          r.data() as Record<string, unknown>,
        )
        count++
        if (batch.needsFlush()) await batch.flush()
      }
    }

    await batch.flush()
    log(`  team_subcollections [${cfg.id}]: ${count} docs written.`)
  }

  await markPassDone(pass)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (DRY_RUN) log('*** DRY RUN — no writes will be committed ***')

  if (TEAM_CONFIGS.length === 0 && !SETUP_ONLY) {
    console.error('ERROR: TEAM_CONFIGS is empty. Populate scripts/migration/config.ts before running.')
    process.exit(1)
  }

  if (SETUP_ONLY) {
    await setupOrg()
    log('Setup complete.')
    return
  }

  await setupOrg()

  const status = await getStatus()
  log(`Migration status: ${JSON.stringify(status)}`)

  await passUsers(status)
  await passTeams(status)
  await passActivities(status)
  await passSessionSeries(status)
  await passContacts(status)
  await passSessions(status)
  await passReferrals(status)
  await passTeamSubcollections(status)

  log('Migration complete.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
