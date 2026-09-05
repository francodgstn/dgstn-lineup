/**
 * Performance check-ins — the data behind the Coaching tab's radar.
 *
 * Another of the shipped-but-empty surfaces the Phase 1 audit names
 * (docs/seed-truth-2026-08.md): `performance_checkins` had no seeder anywhere,
 * so the PERFORMANCE card on every demo contact rendered "No check-ins yet.
 * Record the first one to start the performance profile." — on the same tab as
 * a fully populated attendance chart, which reads as broken rather than empty.
 * The named-profile badge, the weakest/strongest axis prompt and the
 * `checkin_lapsed` attention reason all had nothing to run on either.
 *
 * Three things this file is careful about:
 *
 * 1. `profile_key` / `primary_lever` / `anchor` are NEVER hand-written. They
 *    come from `detectPerformanceProfile`, the one copy of the heuristic
 *    (@linyup/shared), exactly as both real writers call it — the coach dialog
 *    in the contact page and the member's Space. A seed that hard-coded them
 *    would be a second, silently diverging copy of the rules.
 * 2. The ARC is the point, not the snapshot. Each contact gets four check-ins
 *    over six weeks that drift toward a named profile, so the history list
 *    tells a story and the radar is an average of something rather than one
 *    reading. `PROFILE_ARCS` below says which story each one is.
 * 3. The newest entry is always `filled_by: 'student'`, because the badge reads
 *    the latest SELF check-in (`latestStudent?.profile_key`) — seeding only
 *    coach ones would light up the radar and leave the badge blank.
 *
 * Path constants mirror @linyup/shared (same convention as lib/storefront.ts);
 * the heuristic is imported, because it is logic rather than a string.
 */

import admin from 'firebase-admin'
import { detectPerformanceProfile, type ProfileKey } from '@linyup/shared'

const CONTACTS_COLLECTION = 'contacts'
const CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION = 'performance_checkins'
const CONTACT_GOALS_SUBCOLLECTION = 'goals'

const tsOf = (d: Date) => admin.firestore.Timestamp.fromDate(d)

/** `n` days ago at `hour`:`minute` local time. Check-ins land on a clock time a
 *  person would plausibly have filled one in at, not at whatever o'clock the
 *  seed happened to run. */
function daysAgoAt(n: number, hour: number, minute = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, minute, 0, 0)
  return d
}

/** The canonical five, in the order `DEFAULT_COACHING_DIMENSIONS` declares them.
 *  No sandbox team configures `performance_indicators`, so every team resolves
 *  to these — which is also what makes `profile_key` computable at all
 *  (`detectPerformanceProfile` returns null for any other axis set). */
type Scores = { consistency: number; effort: number; focus: number; recharge: number; sense_of_progress: number }

const s = (
  consistency: number,
  effort: number,
  focus: number,
  recharge: number,
  sense_of_progress: number,
): Scores => ({ consistency, effort, focus, recharge, sense_of_progress })

interface ProfileArc {
  /** The pattern the NEWEST entry is built to land on. Advisory: the value
   *  actually stored is whatever the heuristic returns, and `seedPerformanceCheckins`
   *  logs what it got, so a rule change shows up in the seed output instead of
   *  quietly flattening the demo to six identical profiles. */
  intent: ProfileKey
  /** Oldest → newest. Four entries; the last one is the one on the badge. */
  scores: Scores[]
  notes: (string | null)[]
  /** Shifts the whole arc further into the past. One arc uses it so that
   *  `checkin_lapsed` — an attention reason no demo could previously trigger,
   *  since no contact had a `last_checkin_at` at all — has a contact behind it.
   *  DEFAULT_CHECKIN_LAPSE_DAYS is 14. */
  ageDays?: number
}

/**
 * Six arcs, one per named profile the heuristic can report, so a demo shows the
 * range rather than six copies of "balanced". Notes are deliberately free of
 * sport nouns: the same fixture runs for the grappling, CrossFit, tennis, yoga,
 * pilates and dance tenants.
 */
const PROFILE_ARCS: ProfileArc[] = [
  {
    // Everything moving together — the one that needs no intervention.
    intent: 'balanced',
    scores: [s(3, 3, 3, 3, 3), s(4, 3, 3, 4, 3), s(4, 4, 4, 4, 3), s(4, 4, 4, 4, 4)],
    notes: [
      'Settling into the routine. Twice a week is the right load for now.',
      null,
      'Much sharper this block — happy to add a third session.',
      'Feeling good. Everything is clicking at the moment.',
    ],
  },
  {
    // Training harder and recovering less — the pattern worth catching early.
    intent: 'overreaching',
    scores: [s(4, 4, 4, 4, 4), s(4, 4, 3, 3, 4), s(4, 5, 3, 3, 3), s(4, 5, 3, 2, 3)],
    notes: [
      null,
      'Pushing hard. Watch the recovery side over the next few weeks.',
      'Wants to add sessions — suggested keeping it at four.',
      'Tired most mornings but I do not want to drop a session.',
    ],
  },
  {
    // Still turning up, nothing left in the tank.
    intent: 'burnout_risk',
    scores: [s(4, 4, 4, 3, 4), s(4, 3, 3, 3, 3), s(4, 3, 2, 2, 2), s(4, 2, 2, 2, 2)],
    notes: [
      null,
      'Quieter than usual. Work is busy at the moment.',
      'Suggested a lighter week — did not take it.',
      'Turning up but not really there. Could do with a break.',
    ],
  },
  {
    // Working hard, going nowhere — the plateau conversation.
    intent: 'stuck',
    scores: [s(4, 4, 4, 3, 4), s(4, 4, 3, 3, 3), s(5, 4, 3, 3, 2), s(4, 4, 3, 3, 2)],
    notes: [
      'Very consistent. Good base to build on.',
      null,
      'Frustrated with the plateau — worth changing the focus.',
      'Doing the work, not seeing the difference yet.',
    ],
  },
  {
    // Keen when here, often not here. Also the LAPSED one — see ageDays.
    intent: 'inconsistent',
    scores: [s(3, 4, 3, 3, 3), s(2, 4, 4, 3, 3), s(3, 4, 3, 3, 3), s(2, 4, 3, 3, 3)],
    notes: [
      null,
      'Great when here, but the gaps are getting longer.',
      null,
      'Keep missing weeks. Want to get back to a proper rhythm.',
    ],
    ageDays: 31,
  },
  {
    // Present, comfortable, coasting.
    intent: 'coasting',
    scores: [s(4, 4, 4, 4, 4), s(4, 4, 3, 4, 3), s(4, 4, 3, 4, 3), s(4, 4, 2, 4, 3)],
    notes: [
      null,
      'Comfortable at this level. Worth stretching the sessions.',
      null,
      'Enjoying it. Not really pushing myself if I am honest.',
    ],
  },
]

/** What a coach would actually put on the board for a weak axis. Keyed by the
 *  canonical dimension keys; anything else falls back at the call site. */
const STEP_FOR_LEVER: Record<string, string> = {
  consistency: 'Book the week ahead every Sunday.',
  effort: 'Pick one round per session to go properly hard in.',
  focus: 'Choose a single thing to work on before each session starts.',
  recharge: 'Take one full rest day between the two hardest sessions.',
  sense_of_progress: 'Review the last month together and name what has changed.',
}

/** Days before today for each entry in an arc, oldest → newest. The newest is
 *  two days back rather than today so a demo user can still file today's self
 *  check-in — the member surface allows one per DAY and overwrites an existing
 *  one, and overwriting a seeded row is a confusing first interaction. */
const ARC_DAY_OFFSETS = [44, 30, 16, 2]

/** Oldest → newest, so the newest is a self check-in (the badge reads the latest
 *  one filled by the member) and at least one coach-recorded entry is present
 *  (the panel shows the latest of each separately). */
const ARC_FILLED_BY = ['coach', 'student', 'coach', 'student'] as const

export interface CheckinSeedSummary {
  contacts: number
  checkins: number
  steps: number
  profiles: Record<string, number>
  /** Arcs whose newest entry did NOT land on the profile it was built for.
   *  Non-fatal, and reported rather than thrown: a change to
   *  `detectPerformanceProfile` is a legitimate thing to do, and a seed that
   *  refused to run would be the wrong way to find out. Empty is the normal
   *  case — see the note on ProfileArc.intent. */
  drifted: { intended: ProfileKey; got: string }[]
}

/**
 * Seed performance check-ins for the given contacts, one arc each (cycling if
 * more contacts are passed than there are arcs).
 *
 * `Contact.last_checkin_at` is deliberately NOT written here. It is denormalized
 * by the `trackPerformanceCheckins` trigger from a fresh query — the same
 * arrangement the seeded goals already rely on for `coaching_open_count` — so
 * writing it from the seed would create a second writer of a field whose whole
 * design is that it has one.
 *
 * @param contactIds contacts to seed, already filtered by the caller to the ones
 *                   that should have a coaching history (students with goals).
 */
export async function seedPerformanceCheckins({
  contactIds,
}: {
  contactIds: string[]
}): Promise<CheckinSeedSummary> {
  const db = admin.firestore()
  const summary: CheckinSeedSummary = { contacts: 0, checkins: 0, steps: 0, profiles: {}, drifted: [] }

  for (let i = 0; i < contactIds.length; i++) {
    const contactId = contactIds[i]
    const arc = PROFILE_ARCS[i % PROFILE_ARCS.length]
    const age = arc.ageDays ?? 0
    let newestLever: string | null = null

    for (let k = 0; k < arc.scores.length; k++) {
      const scores = arc.scores[k]
      // The stored values come from the heuristic, never from the arc.
      const profile = detectPerformanceProfile(scores)
      const filledBy = ARC_FILLED_BY[k]
      const takenAt = daysAgoAt(ARC_DAY_OFFSETS[k] + age, filledBy === 'coach' ? 11 : 18, 30)

      await db
        .collection(CONTACTS_COLLECTION)
        .doc(contactId)
        .collection(CONTACT_PERFORMANCE_CHECKINS_SUBCOLLECTION)
        .doc(`${contactId}-checkin-${k}`)
        .set({
          taken_at: tsOf(takenAt),
          filled_by: filledBy,
          // The pairing both real writers use: a coach records a 1-to-1, a
          // member files a self check-in. Never mixed.
          context: filledBy === 'coach' ? '1to1' : 'self',
          scores,
          notes: arc.notes[k] ?? null,
          ...profile,
        })
      summary.checkins++

      if (k === arc.scores.length - 1) {
        const key = profile.profile_key ?? 'null'
        summary.profiles[key] = (summary.profiles[key] ?? 0) + 1
        if (key !== arc.intent) summary.drifted.push({ intended: arc.intent, got: key })
        newestLever = profile.primary_lever
      }
    }
    summary.contacts++

    // ── the connection the check-in exists to make ───────────────────────────
    // A step created FROM the weakest axis, carrying `from_dimension` — the
    // provenance link between a low rating and the work that answers it. This
    // is the one thing the seeded goals could not have: their own comment said
    // so ("none is seeded, because no check-ins are seeded"). One step, under a
    // goal the contact already has; contacts with no goal simply skip it.
    if (!newestLever) continue
    const goalSnap = await db
      .collection(CONTACTS_COLLECTION)
      .doc(contactId)
      .collection(CONTACT_GOALS_SUBCOLLECTION)
      .where('type', '==', 'goal')
      .limit(1)
      .get()
    if (goalSnap.empty) continue

    await db
      .collection(CONTACTS_COLLECTION)
      .doc(contactId)
      .collection(CONTACT_GOALS_SUBCOLLECTION)
      .doc(`${contactId}-step-lever`)
      .set({
        type: 'task',
        title: STEP_FOR_LEVER[newestLever] ?? 'Agree one small change with the coach.',
        description: null,
        status: 'open',
        categories: [],
        // PROVENANCE (why this step exists), never a category (what it is
        // about) — see Goal.from_dimension.
        from_dimension: newestLever,
        parent_goal_id: goalSnap.docs[0].id,
        created_by: 'coach',
        created_at: tsOf(daysAgoAt(1 + (arc.ageDays ?? 0), 11, 45)),
        target_date: tsOf(daysAgoAt(-14, 18, 0)),
        completed_at: null,
      })
    summary.steps++
  }

  return summary
}
