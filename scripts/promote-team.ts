/* eslint-disable no-console */
// promote-team.ts — copy ONE team's data from a source Firebase project
// (e.g. linyup-sandbox) into a target project (e.g. linyup-prod), as the
// "promote" step of the sandbox → promote founder-onboarding model
// (see docs/launch/founder-onboarding-runbook.md).
//
// Driven by the tenant-data manifest (TENANT_DATA_COLLECTIONS in @linyup/shared)
// so it stays in sync with the schema. Reuses the migration framework's app-init,
// read-only source proxy, and BatchWriter (scripts/migration/*).
//
// What it copies: the studio's CONTENT — the team doc + all its subcollections,
// contacts/sessions/activities/events/courses/products/etc. and their subtrees,
// plus the public_profile, and (opt-in) Storage under teams/{teamId}/.
//
// What it deliberately does NOT copy: provider plumbing that is test-mode in the
// sandbox and must be re-established LIVE in prod — the Stripe Connect account,
// member payments/subscriptions, the sandbox SaaS subscription, payment events,
// and integration secrets. The founder completes live Connect onboarding + fresh
// SaaS billing in prod (see the runbook).
//
// Idempotent (skip-if-exists by default; --overwrite to mirror), dry-run-able,
// and verifiable (--verify, counts source vs target).
//
// Usage:
//   pnpm promote:team --team <teamId> \
//     --source-creds ./sandbox-sa.json --target-creds ./prod-sa.json \
//     [--dry-run] [--verify] [--overwrite] [--confirm] \
//     [--include-storage --source-bucket <b> --target-bucket <b>] \
//     [--source-label sandbox] [--no-mark]

import { parseArgs } from 'node:util'
import { getApp } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { FieldValue } from 'firebase-admin/firestore'
import {
  TENANT_DATA_COLLECTIONS,
  TENANT_TEAM_DOC_COLLECTION,
  tenantStoragePrefix,
} from '@linyup/shared'
import { initApps, sourceDb, targetDb, type MigrationConfig } from './migration/config'
import { BatchWriter } from './migration/batch-writer'

// ── Promote-specific exclusions ───────────────────────────────────────────────
// Provider plumbing / billing is re-established LIVE in prod, never carried over
// from a test-mode sandbox (a test Connect account or test payment history in
// prod would be wrong).
const EXCLUDED_TOP_LEVEL = new Set<string>([
  'connect_accounts', // test-mode Stripe account → founder re-onboards live
  'saas_subscriptions', // sandbox plan billing → prod billing is separate
  'saas_checkout_attempts', // ephemeral rate-limit ledger
])
const EXCLUDED_TEAM_SUBCOLLECTIONS = new Set<string>([
  'member_payments', // test-mode payment history
  'member_subscriptions', // test-mode subscription history
  'payment_events', // Payrexx test events
  'integrations', // test gateway secrets + email sender → reconfigure in prod
])

type Counts = { docs: number; skipped: number }
type DocRef = FirebaseFirestore.DocumentReference

// Recursively copy a source document and all of its subcollections into target.
async function copyDocTree(
  srcRef: DocRef,
  tgtRef: DocRef,
  bw: BatchWriter,
  opts: { overwrite: boolean; excludeSubcollections?: Set<string> },
  counts: Counts
): Promise<void> {
  const snap = await srcRef.get()
  if (snap.exists) {
    if (opts.overwrite) {
      bw.set(tgtRef, snap.data()!)
      counts.docs++
    } else {
      const existing = await tgtRef.get()
      if (existing.exists) {
        bw.skip()
        counts.skipped++
      } else {
        bw.set(tgtRef, snap.data()!)
        counts.docs++
      }
    }
  }
  const subs = await srcRef.listCollections()
  for (const sub of subs) {
    if (opts.excludeSubcollections?.has(sub.id)) continue
    const docs = await sub.get()
    for (const d of docs.docs) {
      // Nested subcollections are never excluded — only the team's top-level ones.
      await copyDocTree(d.ref, tgtRef.collection(sub.id).doc(d.id), bw, { overwrite: opts.overwrite }, counts)
    }
  }
}

async function copyStorage(
  teamId: string,
  sourceBucket: string,
  targetBucket: string,
  dryRun: boolean
): Promise<number> {
  const src = getStorage(getApp('source')).bucket(sourceBucket)
  const tgt = getStorage(getApp('target')).bucket(targetBucket)
  const prefix = tenantStoragePrefix(teamId)
  const [files] = await src.getFiles({ prefix })
  let n = 0
  for (const f of files) {
    if (!dryRun) {
      const [buf] = await f.download()
      await tgt.file(f.name).save(buf, {
        contentType: (f.metadata.contentType as string | undefined) ?? undefined,
        resumable: false,
      })
    }
    n++
  }
  return n
}

async function verify(teamId: string): Promise<void> {
  console.log('\n=== Verification (source vs target) ===')
  const src = sourceDb()
  const tgt = targetDb()
  const rows: { collection: string; src: number; tgt: number; ok: boolean }[] = []

  // Team doc presence.
  const srcTeam = await src.collection(TENANT_TEAM_DOC_COLLECTION).doc(teamId).get()
  const tgtTeam = await tgt.collection(TENANT_TEAM_DOC_COLLECTION).doc(teamId).get()
  rows.push({
    collection: `${TENANT_TEAM_DOC_COLLECTION}/{id}`,
    src: srcTeam.exists ? 1 : 0,
    tgt: tgtTeam.exists ? 1 : 0,
    ok: !srcTeam.exists || tgtTeam.exists,
  })

  for (const entry of TENANT_DATA_COLLECTIONS) {
    if (EXCLUDED_TOP_LEVEL.has(entry.collection)) continue
    if (entry.match.by === 'field') {
      const s = await src.collection(entry.collection).where(entry.match.field, '==', teamId).count().get()
      // Target docs keep the same teamId field, so the same query verifies them.
      const t = await tgt.collection(entry.collection).where(entry.match.field, '==', teamId).count().get()
      const sc = s.data().count
      const tc = t.data().count
      rows.push({ collection: entry.collection, src: sc, tgt: tc, ok: tc >= sc })
    } else {
      const se = (await src.collection(entry.collection).doc(teamId).get()).exists
      const te = (await tgt.collection(entry.collection).doc(teamId).get()).exists
      rows.push({ collection: `${entry.collection}/{id}`, src: se ? 1 : 0, tgt: te ? 1 : 0, ok: !se || te })
    }
  }

  console.table(rows)
  const failed = rows.filter((r) => !r.ok)
  if (failed.length) {
    console.warn(`WARN: ${failed.length} collection(s) have fewer docs in target than source`)
    process.exitCode = 1
  } else {
    console.log('All counts OK')
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      team: { type: 'string' },
      'source-creds': { type: 'string' },
      'target-creds': { type: 'string' },
      'target-emulator': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      overwrite: { type: 'boolean', default: false },
      confirm: { type: 'boolean', default: false },
      'include-storage': { type: 'boolean', default: false },
      'source-bucket': { type: 'string' },
      'target-bucket': { type: 'string' },
      'source-label': { type: 'string', default: 'sandbox' },
      'no-mark': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  const teamId = values.team
  const targetEmulator = values['target-emulator'] ?? false
  const dryRun = values['dry-run'] ?? false

  if (!teamId) {
    console.error('Error: --team <teamId> is required')
    process.exit(1)
  }
  if (!values['source-creds']) {
    console.error('Error: --source-creds <path> is required')
    process.exit(1)
  }
  if (!targetEmulator && !values['target-creds']) {
    console.error('Error: provide --target-creds <path> or --target-emulator')
    process.exit(1)
  }
  // Writing to a real (non-emulator) project for real requires an explicit ack.
  if (!dryRun && !targetEmulator && !values.confirm) {
    console.error('Refusing to write to a real target project without --confirm (or use --dry-run).')
    process.exit(1)
  }

  const cfg: MigrationConfig = {
    sourceCredsPath: values['source-creds']!,
    targetCredsPath: values['target-creds'],
    targetEmulator,
    dryRun,
    orgAdminEmail: '', // unused by the promote flow
    // NEVER for the promote flow. `overwrite` replaces migrated source documents
    // — contacts, sessions, events, check-ins — with the source's version, which
    // is exactly what a promotion must not do: it is copying a LIVE team, whose
    // current state is the thing being promoted.
    overwrite: false,
  }
  initApps(cfg)

  const overwrite = values.overwrite ?? false
  console.log('=== Promote team ===')
  console.log(`  team:       ${teamId}`)
  console.log(`  source:     ${values['source-creds']}`)
  console.log(`  target:     ${targetEmulator ? 'emulator' : values['target-creds']}`)
  console.log(`  mode:       ${dryRun ? 'DRY-RUN' : 'WRITE'} · ${overwrite ? 'overwrite' : 'skip-if-exists'}`)
  console.log(`  excluded:   ${[...EXCLUDED_TOP_LEVEL].join(', ')} (+ team subcollections: ${[...EXCLUDED_TEAM_SUBCOLLECTIONS].join(', ')})`)

  const src = sourceDb()
  const tgt = targetDb()

  const srcTeam = await src.collection(TENANT_TEAM_DOC_COLLECTION).doc(teamId).get()
  if (!srcTeam.exists) {
    console.error(`Error: team ${teamId} not found in the source project`)
    process.exit(1)
  }

  const bw = new BatchWriter(tgt as unknown as FirebaseFirestore.Firestore, dryRun)
  const counts: Counts = { docs: 0, skipped: 0 }

  // 1) The team doc + all its subcollections (minus provider/billing subcollections).
  console.log('\n· team doc + subcollections…')
  await copyDocTree(
    src.collection(TENANT_TEAM_DOC_COLLECTION).doc(teamId),
    tgt.collection(TENANT_TEAM_DOC_COLLECTION).doc(teamId),
    bw,
    { overwrite, excludeSubcollections: EXCLUDED_TEAM_SUBCOLLECTIONS },
    counts
  )

  // 2) Tenant-scoped top-level collections (manifest-driven), minus excluded ones.
  for (const entry of TENANT_DATA_COLLECTIONS) {
    if (EXCLUDED_TOP_LEVEL.has(entry.collection)) continue
    if (entry.match.by === 'field') {
      const snap = await src.collection(entry.collection).where(entry.match.field, '==', teamId).get()
      console.log(`· ${entry.collection} (${snap.size})…`)
      for (const d of snap.docs) {
        await copyDocTree(d.ref, tgt.collection(entry.collection).doc(d.id), bw, { overwrite }, counts)
      }
    } else {
      console.log(`· ${entry.collection}/${teamId}…`)
      await copyDocTree(
        src.collection(entry.collection).doc(teamId),
        tgt.collection(entry.collection).doc(teamId),
        bw,
        { overwrite },
        counts
      )
    }
  }

  await bw.done()
  console.log(`\nFirestore: wrote ${counts.docs}, skipped ${counts.skipped} (existing).`)

  // 3) Storage (opt-in).
  if (values['include-storage']) {
    if (targetEmulator) {
      console.log('Storage copy skipped (target is the emulator).')
    } else if (!values['source-bucket'] || !values['target-bucket']) {
      console.warn('Storage copy skipped: pass --source-bucket and --target-bucket.')
    } else {
      try {
        const n = await copyStorage(teamId, values['source-bucket'], values['target-bucket'], dryRun)
        console.log(`Storage: ${dryRun ? 'would copy' : 'copied'} ${n} file(s) under ${tenantStoragePrefix(teamId)}`)
      } catch (err) {
        console.error('Storage copy failed (Firestore promote is unaffected):', err)
      }
    }
  } else {
    console.log(`\nNOTE: Storage under ${tenantStoragePrefix(teamId)} was NOT copied. Re-run with --include-storage --source-bucket <b> --target-bucket <b>, or have the studio re-upload media.`)
  }

  // 4) Mark the promoted team in the target (pilot → trial-exempt; provenance).
  if (!dryRun && !values['no-mark']) {
    await tgt.collection(TENANT_TEAM_DOC_COLLECTION).doc(teamId).set(
      {
        flags: {
          pilot: true,
          promotedFrom: values['source-label'] ?? 'sandbox',
          promotedAt: FieldValue.serverTimestamp(),
        },
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    console.log(`Marked target team ${teamId} as pilot (promotedFrom=${values['source-label'] ?? 'sandbox'}).`)
  }

  // 5) Verify (opt-in).
  if (values.verify) await verify(teamId)

  console.log('\nDone. Next: founder completes LIVE Connect onboarding + the controlled first charge (docs/launch/founder-onboarding-runbook.md).')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
