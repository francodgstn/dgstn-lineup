/**
 * Mint version 1 for every document that was already published before
 * versioning existed.
 *
 * ── THIS IS A DEPLOY PRECONDITION, NOT AN OPTION ────────────────────────────
 * Publishing now freezes an immutable snapshot at `documents/{id}/versions/{v}`,
 * and the public mirror COPIES that frozen HTML instead of re-sanitizing the raw
 * body. Every document that is already `status: 'published'` has NO version —
 * the seeder writes `status: 'published', isPublic: true` and no version, and
 * every real team's documents have the same shape. Three things break on that
 * gap, and only the third is loud:
 *
 *   1. `syncDocumentPublicProfile` is an onDocumentWritten trigger, so the
 *      breakage is not immediate: it fires the first time ANYTHING touches a
 *      legacy document, which is exactly when nobody is looking. (The sync
 *      carries a fallback that sanitizes `body` in that case, so the page does
 *      not blank — but the fallback exists to survive an ordering mistake, not
 *      to make this script optional.)
 *   2. `completeSignup` records consent against a real version. Against an
 *      unversioned document it would record `undefined` — the decorative
 *      `version: ''` that this whole phase exists to retire, in a new spelling.
 *   3. `scripts/verify-waiver-ledger.ts` fails on
 *      `status == 'published' && current_version == null`, permanently.
 *
 * Run it BEFORE deploying the mirror-source change. Reversed, a legacy
 * document's public page depends on a fallback rather than on its snapshot.
 *
 * ── WHY IT IS NOT OPT-IN, UNLIKE THE MIRROR BACKFILL ────────────────────────
 * The mirror backfill (which publishes dark content) is opt-in per team because
 * it makes a studio's documents publicly visible. This one changes NOTHING a
 * visitor can see: it captures text that is already published, at the same
 * clamp and through the same sanitizer the mirror has always used, so the bytes
 * on the public page are identical afterwards.
 *
 * ── RE-RUNNABLE ─────────────────────────────────────────────────────────────
 * `.create()` + ALREADY_EXISTS-is-a-skip, and it only ever touches documents
 * whose `current_version` is missing. Running it twice is a no-op.
 *
 * Auth: gcloud Application Default Credentials (ADC), like the other scripts.
 * Against the emulator, set FIRESTORE_EMULATOR_HOST and use the demo project.
 *
 * Usage:
 *   tsx scripts/backfill-document-versions.ts --project linyup-staging [--team t1] [--apply]
 *
 * Without --apply it only reports what it would write.
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { Timestamp } from 'firebase-admin/firestore'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_VERSIONS_SUBCOLLECTION,
  MAX_WAIVER_BODY_CHARS,
  TEAMS_COLLECTION,
  documentVersionId,
  type DocumentVersion,
} from '@linyup/shared'
// DELIBERATE cross-package import, and the opposite of what
// scripts/backfill-finance-journal.ts does with the journal's `toDoc` (it
// mirrors it, because a drift there is only a formatting difference). Here the
// bytes MUST be identical to what the mirror produces, because the hash of them
// is what every acceptance pins: a copy of the sanitizer is exactly the wrong
// answer. Both modules import only node:crypto / sanitize-html, so they resolve
// from the functions package's own node_modules with no build step.
import { sanitizeRichHtml, safeExternalUrl } from '../packages/functions/src/utils/sanitizeHtml'
import { sha256Hex } from '../packages/functions/src/utils/crypto'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    team: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
})

if (!values.project) {
  console.error('❌ --project is required (e.g. --project linyup-staging, or demo-linyup for the emulator)')
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

const stats = { scanned: 0, needing: 0, created: 0, existed: 0, skipped: 0 }

/** Cache of teamId → (uid → display name), so a team's members are read once. */
const memberNames = new Map<string, Map<string, string>>()

async function publisherName(teamId: string, uid: string | undefined): Promise<string> {
  if (!uid) return '—'
  if (!memberNames.has(teamId)) {
    const snap = await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection('team_members')
      .get()
    const map = new Map<string, string>()
    for (const d of snap.docs) {
      const n = (d.data().name ?? d.data().displayName ?? d.data().email) as string | undefined
      if (n) map.set(d.id, n)
    }
    memberNames.set(teamId, map)
  }
  return memberNames.get(teamId)!.get(uid) ?? '—'
}

async function main() {
  console.log(
    `\n🔧 Document version backfill on '${values.project}'${values.team ? ` (team ${values.team})` : ''} ${
      values.apply ? '(APPLY)' : '(dry-run)'
    }\n`
  )

  // `status == 'published'` is a single-field equality, served by the automatic
  // index. The `current_version` filter is done IN MEMORY on purpose:
  // `where('current_version','==',null)` matches documents whose field is
  // explicitly null and NOT documents where the field is ABSENT — which is
  // every document this script exists for.
  let query: FirebaseFirestore.Query = db
    .collection(DOCUMENTS_COLLECTION)
    .where('status', '==', 'published')
  if (values.team) query = query.where('teamId', '==', values.team)

  const snap = await query.get()

  for (const doc of snap.docs) {
    stats.scanned += 1
    const d = doc.data()
    if (typeof d.current_version === 'number') continue
    stats.needing += 1

    const teamId = d.teamId as string
    const source = (d.source as string) ?? 'rich_text'
    const isRich = source === 'rich_text'

    // The SAME call at the SAME clamp the mirror uses, so the public bytes do
    // not change on the way to being versioned.
    const bodyHtml = isRich
      ? sanitizeRichHtml(typeof d.body === 'string' ? d.body.slice(0, MAX_WAIVER_BODY_CHARS) : '')
      : ''
    const externalUrl = isRich ? null : (safeExternalUrl(d.externalUrl) ?? null)

    if (isRich && !bodyHtml.trim()) {
      // A published document with no body at all. Minting an empty snapshot
      // would let an acceptance pin the hash of nothing, which is worse than
      // leaving it visible in this report.
      stats.skipped += 1
      console.log(`   ⚠ skipped ${doc.id} (${d.title ?? '?'}) — published with an empty body`)
      continue
    }
    if (!isRich && !externalUrl) {
      stats.skipped += 1
      console.log(`   ⚠ skipped ${doc.id} (${d.title ?? '?'}) — published with no valid external URL`)
      continue
    }

    const publishedAt = (d.updated_at as Timestamp | undefined) ?? Timestamp.now()
    const version: DocumentVersion = {
      teamId,
      documentId: doc.id,
      version: 1,
      kind: (d.kind as DocumentVersion['kind']) ?? 'other',
      title: (d.title as string) ?? '',
      bodyHtml,
      bodyHash: sha256Hex(bodyHtml),
      bodyChars: bodyHtml.length,
      externalUrl,
      // No document could have carried a waiver's minors flag before waivers
      // existed, so there is nothing to freeze.
      mayIncludeMinors: null,
      publish_outcome: 'silent',
      // `supersedes: null` and `min_valid_version` left untouched: A BACKFILL
      // MUST NOT SUPERSEDE ANYBODY. Nobody is asked to re-sign because a
      // snapshot was taken.
      supersedes: null,
      published_at: publishedAt,
      published_by: (d.createdBy as string) ?? '',
      published_by_name: await publisherName(teamId, d.createdBy as string | undefined),
      // THE marker the export prints. A member who signed in 2025 signed text
      // captured in 2026, and printing that as an ordinary publish would assert
      // more than happened.
      backfilled_at: Timestamp.now(),
    }

    if (!values.apply) {
      console.log(`   would mint v0001 for ${doc.id} (${d.title ?? '?'}) — team ${teamId}`)
      continue
    }

    try {
      await doc.ref
        .collection(DOCUMENT_VERSIONS_SUBCOLLECTION)
        .doc(documentVersionId(1))
        .create(version as FirebaseFirestore.DocumentData)
      stats.created += 1
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 6) {
        stats.existed += 1 // ALREADY_EXISTS — a re-run, not an error
      } else {
        throw err
      }
    }

    // Written AFTER the snapshot exists, so an interrupted run never leaves a
    // document claiming a version that was never created.
    await doc.ref.update({ current_version: 1 })
    console.log(`   ✔ ${doc.id} (${d.title ?? '?'}) → v0001`)
  }

  console.log(
    `\n📊 scanned ${stats.scanned} published documents · ${stats.needing} without a version · ` +
      `${stats.created} minted · ${stats.existed} already had a snapshot · ${stats.skipped} skipped\n`
  )
  if (!values.apply && stats.needing > 0) {
    console.log('   Re-run with --apply to write.\n')
  }
  if (stats.skipped > 0) {
    console.error(
      '❗ Some published documents could not be versioned (see ⚠ above). Fix or unpublish them —\n' +
        '   verify-waiver-ledger will keep failing while they exist.\n'
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
