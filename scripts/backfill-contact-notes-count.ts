/**
 * Stamp `notes_count` on every contact that already has notes.
 *
 * ── WHY IT IS NEEDED ────────────────────────────────────────────────────────
 * The "Has notes" contact filter reads `Contact.notes_count`, a denormalised
 * counter maintained by the `trackContactNotes` trigger. A trigger only ever
 * fires on a WRITE, so every note written before it was deployed left no count
 * behind — and the filter reads an absent counter as zero, deliberately (see
 * the fixtures in contacts/contactFilter.test.ts). Without this pass, a studio
 * with years of notes filters on "Has notes" and gets an empty list: no error,
 * no hint, just a wrong answer stated confidently.
 *
 * This is therefore a DEPLOY PRECONDITION for the filter, in the same sense as
 * `backfill-document-versions.ts` — deploy the trigger, run this, then the
 * filter tells the truth.
 *
 * ── WHAT IT READS ───────────────────────────────────────────────────────────
 * A collection-group scan of `contact_notes`, tallied per parent contact, so it
 * costs one read per NOTE rather than one query per contact. A contact with no
 * notes never appears in the scan and is never written — which is also why the
 * absent-means-zero reading above has to hold.
 *
 * ── WHAT IT WRITES ──────────────────────────────────────────────────────────
 * A single-field `update({ notes_count })`, and only where the stored value
 * actually differs. It cannot flip a status, cannot touch a note, and fires no
 * automation: `notes_count` is in the server-written field set that
 * firestore.rules locks, and nothing keys on it but the filter.
 *
 * ── RE-RUNNABLE ─────────────────────────────────────────────────────────────
 * It computes an ABSOLUTE count from the subcollection, exactly as the trigger
 * does, so running it twice writes nothing the second time and running it after
 * the trigger is live simply agrees with it.
 *
 * Auth: gcloud Application Default Credentials (ADC), like the other scripts.
 * Against the emulator, set FIRESTORE_EMULATOR_HOST and use the demo project.
 *
 * Usage:
 *   tsx scripts/backfill-contact-notes-count.ts --project linyup-staging [--team t1] [--apply]
 *
 * Without --apply it only reports what it would write.
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { FieldPath } from 'firebase-admin/firestore'
import { CONTACTS_COLLECTION, CONTACT_NOTES_SUBCOLLECTION } from '@linyup/shared'

/** One scan page. Small enough to keep memory flat on a collection group that
 *  grows with every note any studio has ever written. */
const PAGE = 1000

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    team: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
})

if (!values.project) {
  console.error(
    '❌ --project is required (e.g. --project linyup-staging, or demo-linyup for the emulator)'
  )
  process.exit(1)
}

admin.initializeApp({ credential: applicationDefault(), projectId: values.project })
const db = admin.firestore()

const stats = { notes: 0, contacts: 0, written: 0, unchanged: 0, missing: 0, skippedTeam: 0 }

async function main() {
  console.log(
    `\n🔧 Contact notes_count backfill on '${values.project}'${
      values.team ? ` (team ${values.team})` : ''
    } ${values.apply ? '(APPLY)' : '(dry-run)'}\n`
  )

  // TALLY FIRST, WRITE SECOND. The alternative — query each contact's notes —
  // is one query per contact across the whole tenant; this is one read per note
  // and none for a contact that has none.
  const counts = new Map<string, number>()
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null

  for (;;) {
    let q = db
      .collectionGroup(CONTACT_NOTES_SUBCOLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(PAGE)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break

    for (const doc of snap.docs) {
      // The parent of a `contact_notes` document is the contact. Guard rather
      // than assume: a collection-group scan matches the subcollection NAME
      // wherever it appears, and a future writer could put one elsewhere.
      const contactRef = doc.ref.parent.parent
      if (!contactRef || contactRef.parent.id !== CONTACTS_COLLECTION) continue
      stats.notes++
      counts.set(contactRef.id, (counts.get(contactRef.id) ?? 0) + 1)
    }

    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE) break
  }

  stats.contacts = counts.size
  console.log(`   scanned ${stats.notes} note(s) across ${stats.contacts} contact(s)`)

  for (const [contactId, count] of counts) {
    const ref = db.collection(CONTACTS_COLLECTION).doc(contactId)
    const snap = await ref.get()
    if (!snap.exists) {
      // A note whose contact was hard-deleted. Nothing to write, and worth
      // reporting rather than silently ignoring.
      stats.missing++
      continue
    }
    const data = snap.data()!
    if (values.team && data.teamId !== values.team) {
      stats.skippedTeam++
      continue
    }
    if ((data.notes_count as number | undefined) === count) {
      stats.unchanged++
      continue
    }
    if (values.apply) await ref.update({ notes_count: count })
    stats.written++
  }

  console.log(
    `\n${values.apply ? '✅ wrote' : '📋 would write'} ${stats.written} contact(s); ` +
      `${stats.unchanged} already correct` +
      (stats.missing ? `; ${stats.missing} note(s) whose contact is gone` : '') +
      (stats.skippedTeam ? `; ${stats.skippedTeam} outside --team` : '')
  )
  if (!values.apply) console.log('\n   Re-run with --apply to write.\n')
}

main().catch((err) => {
  console.error('❌ backfill failed:', err)
  process.exit(1)
})
