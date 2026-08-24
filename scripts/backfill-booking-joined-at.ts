/**
 * Stamp `joinedAt` on every booking that was written without one.
 *
 * ── WHY A BOOKING CAN BE INVISIBLE ──────────────────────────────────────────
 * The surfaces that list bookings order on `joinedAt` — the studio's /bookings
 * list, the contact record's bookings tab and the member's own `getMyBookings`
 * — and the composite indexes behind them are SPARSE.
 * Firestore silently drops any document that lacks the ordering field, so a
 * booking with no `joinedAt` is not missing from the RESULT, it is missing from
 * the INDEX: no error, no empty-state hint, just a seat that exists on the
 * session roster (the one reader that does not sort) and nowhere else in the
 * product.
 *
 * The staff "Add contact" dialog on the session detail page wrote exactly that
 * shape — a direct client write with no server seam, so no callable-side guard
 * could have caught it. It stamps `joinedAt` now; this script is for the seats
 * hand-added before it did. WITHOUT IT, every one of those stays invisible.
 * Run it as a deploy precondition, alongside the new indexes.
 *
 * ── WHERE THE VALUE COMES FROM ──────────────────────────────────────────────
 * `created_at` (what the staff door wrote), else `confirmed_at`, else the
 * parent SESSION's start. All three are honest answers to "when was this seat
 * taken", in decreasing order of precision; `Timestamp.now()` is deliberately
 * NOT a fallback, because stamping today onto a seat taken last March would
 * sort a year of history to the top of every list. A booking with none of the
 * three is reported and skipped rather than guessed at.
 *
 * ── WHAT IT SETS OFF ────────────────────────────────────────────────────────
 * Every touched document fires `trackBookings`, which recounts the session's
 * `bookings_count` from the subcollection (absolute, so it CORRECTS rather than
 * drifts) and rewrites `session.status`. It also logs one activity row per
 * write, so a large run leaves booking-shaped noise in the team activity log —
 * run it off-peak. The one recount that is skipped is a session in
 * `pending_payment`: the trigger returns early there, so an appointment hold
 * mid-checkout is not disturbed.
 *
 * The write is a single-field `update()`, so a status flip is impossible and no
 * automation that keys on status can fire.
 *
 * ── RE-RUNNABLE ─────────────────────────────────────────────────────────────
 * It only ever touches documents where `joinedAt` is absent, so a second run
 * writes nothing. Paged by document id, so an interrupted run resumes by simply
 * being run again.
 *
 * Auth: gcloud Application Default Credentials (ADC), like the other scripts.
 * Against the emulator, set FIRESTORE_EMULATOR_HOST and use the demo project.
 *
 * Usage:
 *   tsx scripts/backfill-booking-joined-at.ts --project linyup-staging [--team t1] [--apply]
 *
 * Without --apply it only reports what it would write. `--team` narrows what is
 * written, not what is read — see the scan below.
 */

import { parseArgs } from 'node:util'
import admin from 'firebase-admin'
import { applicationDefault } from 'firebase-admin/app'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { SESSIONS_COLLECTION } from '@linyup/shared'

const BOOKINGS_SUBCOLLECTION = 'bookings'
/** One scan page. Small enough to keep memory flat on a collection group that
 *  grows with every class a studio has ever run. */
const PAGE = 500

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

const stats = { scanned: 0, needing: 0, written: 0, fromCreated: 0, fromConfirmed: 0, fromSession: 0, skipped: 0 }

/** sessionId → start, read once per session however many of its bookings need it. */
const sessionStarts = new Map<string, Timestamp | null>()

async function sessionStart(sessionId: string): Promise<Timestamp | null> {
  if (sessionStarts.has(sessionId)) return sessionStarts.get(sessionId)!
  const snap = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get()
  const start = snap.exists ? ((snap.data()?.start as Timestamp | undefined) ?? null) : null
  sessionStarts.set(sessionId, start)
  return start
}

async function main() {
  console.log(
    `\n🔧 Booking joinedAt backfill on '${values.project}'${values.team ? ` (team ${values.team})` : ''} ${
      values.apply ? '(APPLY)' : '(dry-run)'
    }\n`
  )

  // BOTH FILTERS ARE APPLIED IN MEMORY, for different reasons.
  //
  // `joinedAt` because it has to be: `where('joinedAt','==',null)` matches
  // documents whose field is explicitly null and NOT documents where it is
  // ABSENT — which is every document this script exists for.
  //
  // `teamId` because pushing it into the query would need a
  // `(teamId, __name__)` collection-group index that this repo does not ship,
  // and a backfill that fails on a missing index at the moment somebody is
  // repairing production is a poor trade for one scan. --team narrows what is
  // WRITTEN, not what is read.
  //
  // Paged by `__name__` — every document has one, so unlike the field this
  // script repairs, nothing can drop out of the scan.
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let query: FirebaseFirestore.Query = db
      .collectionGroup(BOOKINGS_SUBCOLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(PAGE)
    if (cursor) query = query.startAfter(cursor)

    const snap = await query.get()
    if (snap.empty) break

    for (const doc of snap.docs) {
      const d = doc.data()
      if (values.team && d.teamId !== values.team) continue
      stats.scanned += 1
      if (d.joinedAt) continue
      stats.needing += 1

      const sessionId = doc.ref.parent.parent?.id ?? ''
      const created = d.created_at as Timestamp | undefined
      const confirmed = d.confirmed_at as Timestamp | undefined
      let joinedAt: Timestamp | null = null
      let source = ''
      if (created) {
        joinedAt = created
        source = 'created_at'
        stats.fromCreated += 1
      } else if (confirmed) {
        joinedAt = confirmed
        source = 'confirmed_at'
        stats.fromConfirmed += 1
      } else if (sessionId) {
        joinedAt = await sessionStart(sessionId)
        source = 'session start'
        if (joinedAt) stats.fromSession += 1
      }

      const who = `${(d.firstname as string) ?? ''} ${(d.lastname as string) ?? ''}`.trim() || doc.id
      if (!joinedAt) {
        stats.skipped += 1
        console.log(`   ⚠ skipped ${doc.ref.path} (${who}) — no created_at, confirmed_at or session start`)
        continue
      }

      if (!values.apply) {
        console.log(`   would stamp ${doc.ref.path} (${who}) ← ${source} ${joinedAt.toDate().toISOString()}`)
        continue
      }

      await doc.ref.update({ joinedAt })
      stats.written += 1
      console.log(`   ✔ ${doc.ref.path} (${who}) ← ${source}`)
    }

    if (snap.size < PAGE) break
    cursor = snap.docs[snap.docs.length - 1]
  }

  console.log(
    `\n📊 scanned ${stats.scanned} bookings · ${stats.needing} without joinedAt · ${stats.written} stamped ` +
      `(${stats.fromCreated} from created_at, ${stats.fromConfirmed} from confirmed_at, ${stats.fromSession} from the session start) · ` +
      `${stats.skipped} skipped\n`
  )
  if (!values.apply && stats.needing > 0) {
    console.log('   Re-run with --apply to write.\n')
  }
  if (stats.skipped > 0) {
    console.error(
      '❗ Some bookings could not be dated (see ⚠ above). They stay invisible to every list that\n' +
        '   orders on joinedAt; give them a created_at by hand, or delete them if they are debris.\n'
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
