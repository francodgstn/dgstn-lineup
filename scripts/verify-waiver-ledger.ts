/**
 * Read-only integrity check over the waiver ledger. Exit code 0 = clean.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * "Append-only by convention over the Admin SDK" is an INTENTION, not an
 * enforcement. `allow write: if false` stops clients; it does not stop a
 * migration script, a Firebase console edit, or a future callable written by
 * someone who did not read the docblocks. The finance journal — which this
 * ledger's two-halves design is copied from — does not rely on discipline
 * alone: it has `assertFinanceInvariant`, a reconciliation check and a backfill
 * script, i.e. a checker, an alarm and a repair path. The waiver ledger
 * inherited the convention and none of the machinery. This is the checker.
 *
 * It also gives the export something to point at. An artefact that tells a
 * lawyer "the stored fingerprint does not match the stored text" and stops
 * there is worse than one that does not check; the export names this script as
 * the next step.
 *
 * ── WHAT IT CHECKS, AND WHY EACH CAN FAIL DESPITE THE RULES ─────────────────
 *   • body_hash === sha256(bodyHtml) for every version
 *       — the Admin SDK bypasses `allow write: if false`; a migration or a
 *         console edit is the realistic cause.
 *   • every signer row is backed by an acceptance event AT THE VERSION IT
 *     CLAIMS, and that event is kind: 'accepted'
 *       — a signer write that landed while its event create was skipped, or the
 *         precedence rule applied against a row it should not have.
 *   • every required policy entry matches its document's current_version /
 *     min_valid_version, AND every required published waiver has an entry
 *       — the policy's "always agrees with the documents" is an assertion until
 *         something checks it, in both directions. (The Documents page runs the
 *         same converse on load and shows a banner; this is the same check with
 *         an exit code.)
 *   • no document has status: 'published' && current_version == null
 *       — the version backfill's precondition, permanently.
 *
 * ── CADENCE ─────────────────────────────────────────────────────────────────
 * Pre-release and on demand, deliberately NOT a scheduled entry: this feature's
 * standing invariant is that expiry and supersession are derived rather than
 * swept, and adding a cron here would be the first scheduled job in an area
 * whose whole design is "compute, don't sweep". There is no corruption vector
 * until somebody runs an Admin-SDK migration — which is precisely when a human
 * should run this by hand.
 *
 * Auth: gcloud Application Default Credentials (ADC), like the other scripts.
 * Against the emulator, set FIRESTORE_EMULATOR_HOST and use the demo project.
 *
 * Usage:
 *   tsx scripts/verify-waiver-ledger.ts --project linyup-staging [--team t1] [--verbose]
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import {
  DOCUMENTS_COLLECTION,
  DOCUMENT_ACCEPTANCES_SUBCOLLECTION,
  DOCUMENT_SIGNERS_SUBCOLLECTION,
  DOCUMENT_VERSIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  WAIVER_POLICY_DOC_ID,
  WAIVER_POLICY_SUBCOLLECTION,
  waiverPolicyEntryFor,
  type RequiredWaiverEntry,
  type WaiverPolicySourceDocument,
} from '@linyup/shared'
// Same sha256 the publish callable uses. A second implementation here would
// make a hash "mismatch" report a difference between two hashers rather than a
// difference in the text — see scripts/backfill-document-versions.ts.
import { sha256Hex } from '../packages/functions/src/utils/crypto'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    team: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
})

if (!values.project) {
  console.error('❌ --project is required (e.g. --project linyup-staging, or demo-linyup for the emulator)')
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

interface Failure {
  check: string
  where: string
  detail: string
}

const failures: Failure[] = []
const counts = { documents: 0, versions: 0, signers: 0, policies: 0 }

function fail(check: string, where: string, detail: string): void {
  failures.push({ check, where, detail })
}

function note(msg: string): void {
  if (values.verbose) console.log(`   ${msg}`)
}

function policySourceFrom(
  documentId: string,
  d: FirebaseFirestore.DocumentData
): WaiverPolicySourceDocument {
  return {
    documentId,
    slug: (d.slug as string) ?? '',
    title: (d.title as string) ?? '',
    kind: d.kind ?? 'other',
    status: (d.status as string) ?? 'draft',
    archived_at: d.archived_at,
    current_version: (d.current_version as number | null) ?? null,
    min_valid_version: (d.min_valid_version as number | null) ?? null,
    waiver: d.waiver ?? null,
  }
}

/** Everything is read per DOCUMENT and per TEAM — no collection-group query, so
 *  this script adds no index of its own. A team's document count is small. */
async function main() {
  console.log(
    `\n🔎 Waiver ledger check on '${values.project}'${values.team ? ` (team ${values.team})` : ''}\n`
  )

  let docQuery: FirebaseFirestore.Query = db.collection(DOCUMENTS_COLLECTION)
  if (values.team) docQuery = docQuery.where('teamId', '==', values.team)
  const documents = await docQuery.get()

  /** teamId → documentId → the entry the policy SHOULD carry. */
  const expectedPolicy = new Map<string, Map<string, RequiredWaiverEntry>>()

  for (const doc of documents.docs) {
    counts.documents += 1
    const d = doc.data()
    const teamId = d.teamId as string
    const label = `documents/${doc.id} (${d.title ?? '?'})`

    // ── every published document has a version ──────────────────────────────
    if (d.status === 'published' && typeof d.current_version !== 'number') {
      fail(
        'published-without-version',
        label,
        'published with no current_version — run scripts/backfill-document-versions.ts'
      )
    }

    // ── every version's hash matches its own text ───────────────────────────
    const versions = await doc.ref.collection(DOCUMENT_VERSIONS_SUBCOLLECTION).get()
    const versionNumbers = new Set<number>()
    let currentBodyHash: string | null = null
    for (const v of versions.docs) {
      counts.versions += 1
      const vd = v.data()
      versionNumbers.add(vd.version as number)
      const expected = sha256Hex((vd.bodyHtml as string) ?? '')
      if (vd.bodyHash !== expected) {
        fail(
          'version-hash-mismatch',
          `${label} → versions/${v.id}`,
          `stored ${String(vd.bodyHash).slice(0, 16)}… but the stored text hashes to ${expected.slice(0, 16)}… — ` +
            `published_at ${String(vd.published_at?.toDate?.() ?? '?')} by ${vd.published_by_name ?? '?'}`
        )
      }
      if (vd.version === d.current_version) currentBodyHash = (vd.bodyHash as string) ?? null
    }
    if (typeof d.current_version === 'number' && !versionNumbers.has(d.current_version)) {
      fail(
        'missing-current-version',
        label,
        `current_version is ${d.current_version} but no such snapshot exists`
      )
    }

    // ── every signer row is backed by an accepted event at its version ──────
    const signers = await doc.ref.collection(DOCUMENT_SIGNERS_SUBCOLLECTION).get()
    for (const s of signers.docs) {
      counts.signers += 1
      const sd = s.data()
      const acceptanceId = sd.acceptance_id as string | undefined
      if (!acceptanceId) {
        fail('signer-without-event', `${label} → signers/${s.id}`, 'no acceptance_id')
        continue
      }
      const evt = await doc.ref
        .collection(DOCUMENT_ACCEPTANCES_SUBCOLLECTION)
        .doc(acceptanceId)
        .get()
      if (!evt.exists) {
        fail(
          'signer-without-event',
          `${label} → signers/${s.id}`,
          `acceptance_id ${acceptanceId} does not exist`
        )
        continue
      }
      const ed = evt.data()!
      if (ed.kind !== 'accepted') {
        fail(
          'signer-backed-by-non-acceptance',
          `${label} → signers/${s.id}`,
          `acceptance_id ${acceptanceId} is kind '${ed.kind}'`
        )
      }
      if (ed.version !== sd.accepted_version) {
        fail(
          'signer-version-mismatch',
          `${label} → signers/${s.id}`,
          `row claims v${sd.accepted_version} but its event is v${ed.version}`
        )
      }
      if (ed.contactId !== s.id) {
        fail(
          'signer-contact-mismatch',
          `${label} → signers/${s.id}`,
          `its event names contact ${ed.contactId}`
        )
      }
      // A revoked row must carry the instant the precedence rule orders on.
      if (sd.status === 'revoked' && !sd.revoked_at) {
        fail(
          'revoked-without-instant',
          `${label} → signers/${s.id}`,
          'status is revoked with no revoked_at — a later acceptance would silently undo it'
        )
      }
    }

    // ── what the policy SHOULD say about this document ──────────────────────
    const entry = waiverPolicyEntryFor(policySourceFrom(doc.id, d), currentBodyHash ?? '')
    if (entry) {
      if (!expectedPolicy.has(teamId)) expectedPolicy.set(teamId, new Map())
      expectedPolicy.get(teamId)!.set(doc.id, entry)
    }
    note(`checked ${label}`)
  }

  // ── the policy agrees with the documents, IN BOTH DIRECTIONS ─────────────
  const teamIds = values.team
    ? [values.team]
    : [...new Set(documents.docs.map((d) => d.data().teamId as string).filter(Boolean))]

  for (const teamId of teamIds) {
    const policySnap = await db
      .collection(TEAMS_COLLECTION)
      .doc(teamId)
      .collection(WAIVER_POLICY_SUBCOLLECTION)
      .doc(WAIVER_POLICY_DOC_ID)
      .get()
    const stored = (policySnap.data()?.required as RequiredWaiverEntry[] | undefined) ?? []
    counts.policies += 1
    const expected = expectedPolicy.get(teamId) ?? new Map<string, RequiredWaiverEntry>()

    for (const e of stored) {
      const want = expected.get(e.documentId)
      if (!want) {
        fail(
          'policy-entry-orphaned',
          `teams/${teamId}/waiver_policy/current`,
          `names ${e.documentId}, which is not a required, published, unarchived, versioned waiver — the gate points at nothing`
        )
        continue
      }
      if (
        e.current_version !== want.current_version ||
        e.min_valid_version !== want.min_valid_version ||
        e.body_hash !== want.body_hash
      ) {
        fail(
          'policy-entry-stale',
          `teams/${teamId}/waiver_policy/current`,
          `${e.documentId}: policy says v${e.current_version}/floor ${e.min_valid_version}, ` +
            `document says v${want.current_version}/floor ${want.min_valid_version}`
        )
      }
    }
    for (const [documentId] of expected) {
      if (!stored.some((e) => e.documentId === documentId)) {
        fail(
          'policy-entry-missing',
          `teams/${teamId}/waiver_policy/current`,
          `${documentId} is a required waiver with no policy entry — it is NOT being enforced`
        )
      }
    }
  }

  // ── report ───────────────────────────────────────────────────────────────
  console.log(
    `📊 ${counts.documents} documents · ${counts.versions} versions · ${counts.signers} signer rows · ${counts.policies} team policies\n`
  )

  if (failures.length === 0) {
    console.log('✅ clean\n')
    return
  }

  for (const f of failures) {
    console.error(`❌ [${f.check}] ${f.where}\n   ${f.detail}`)
  }
  console.error(`\n${failures.length} problem(s) found.\n`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
