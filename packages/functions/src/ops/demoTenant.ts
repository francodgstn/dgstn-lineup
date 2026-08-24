/**
 * THE PRODUCTION DEMO TENANT — the studio a store reviewer signs into.
 *
 * ── WHY THIS IS A CALLABLE AND NOT A SCRIPT ──────────────────────────────────
 *
 * Every other seeder in this repo is a local script, and each one hard-codes a
 * non-prod project and refuses to run when the ambient project disagrees. This
 * one deliberately does NOT join that family (Franco, 2026-08-21), for two
 * reasons that are about people rather than code:
 *
 *   1. A rail that shares no muscle memory with `pnpm lead:seed`. The failure
 *      being designed out is real and recent: a lead seed run with `--reset`,
 *      expecting the emulator, hit the CLOUD sandbox — purely because the
 *      default target and the operator's mental mode disagreed. Production data
 *      should not be one forgotten flag away from a command you type weekly.
 *   2. No dependency on one laptop's credentials.
 *
 * So the console is the TRIGGER and this is the EXECUTOR. The code ships
 * through the reviewed `deploy-prod.yml` (verify → `production` environment
 * approval); the button is just an authenticated operator action. It also gets
 * a real function timeout instead of a Next server action's request budget.
 *
 * ── WHY THE CONTENT IS DEFINED HERE AND NOT REUSED ───────────────────────────
 *
 * `scripts/lib/fixtures/*` is tempting and wrong: the dependency runs
 * scripts→functions (`fixtures/finance.ts` imports from `packages/functions/src`),
 * so importing them here would invert it. The demo set is also deliberately
 * SMALL — the reviewer is a contact, not a manager. They need a schedule with
 * something on it, a booking of their own, and a membership. Not a studio.
 *
 * ── THE SAFETY PROPERTIES, AND WHERE THEY COME FROM ──────────────────────────
 *
 * - **Sends nothing.** `messaging_policies/{teamId}` is written `silent` BEFORE
 *   any content lands, because `MESSAGING_DEFAULT_MODE` is `live` in prod and an
 *   absent policy means real delivery. Belt and braces: every seeded contact is
 *   `@example.com`, which `isSyntheticEmail()` drops unconditionally in every
 *   environment.
 * - **Cannot take money.** No Stripe Connect account is ever attached, so
 *   `TeamPublicProfile.payments_enabled` fails closed and every priced door —
 *   shop, drop-in, priced trial, paid appointment — is absent. A reviewer
 *   cannot trigger a real charge on a live-mode platform.
 * - **Does not pollute the numbers.** `flags.internal` excludes it from
 *   platform metrics and exempts it from the trial sweep, so it cannot silently
 *   lapse to Free in the middle of a review.
 *
 * WRITE ORDER MATTERS: the team doc goes first so `onTeamCreated` and
 * `syncTeamPublicProfile` fire — nothing else builds `public_profile`, and every
 * public surface reads it.
 */
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import {
  TEAMS_COLLECTION,
  CONTACTS_COLLECTION,
  ACTIVITIES_COLLECTION,
  SESSIONS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  DEFAULT_PAYMENT_MODES,
} from '@linyup/shared'

/** Fixed ids so every run converges on the same documents — this is what makes
 *  `provision` idempotent and `reset` meaningful. */
export const DEMO_TEAM_ID = 'linyup-demo'
export const DEMO_OWNER_UID = 'linyup-demo-owner'
const DEMO_SLUG = 'linyup-demo'

/** The contact a store reviewer signs in as. Its email is what
 *  `app_settings/review_access` allowlists. `@example.com` so the synthetic
 *  guard drops any mail addressed to it even if a policy is ever misread. */
export const DEMO_REVIEW_CONTACT_ID = 'linyup-demo-reviewer'
export const DEMO_REVIEW_EMAIL = 'app.review@example.com'

const DAY_MS = 24 * 60 * 60 * 1000

interface DemoActivity {
  id: string
  name: string
  slug: string
  color: string
  description: string
  /** Hour of the day, local wall clock, for the generated sessions. */
  hour: number
  /** Weekdays it runs on, `Date#getDay()` convention. */
  days: number[]
  /** Free-text display chips, so the review tenant exercises the public
   *  booking card's tag row rather than leaving it empty. */
  tags?: string[]
}

const ACTIVITIES: DemoActivity[] = [
  {
    id: `${DEMO_TEAM_ID}-act-morning-flow`,
    name: 'Morning Flow',
    slug: 'morning-flow',
    color: '#0EA5E9',
    description: 'A gentle hour to start the day. All levels welcome.',
    hour: 8,
    days: [1, 3, 5],
    tags: ['Beginner friendly', 'Mornings'],
  },
  {
    id: `${DEMO_TEAM_ID}-act-evening-strength`,
    name: 'Evening Strength',
    slug: 'evening-strength',
    color: '#7C3AED',
    description: 'Technique and conditioning. Bring water.',
    hour: 18,
    days: [2, 4],
    tags: ['Strength'],
  },
]

/** Six people so a roster looks like a roster. The reviewer is the first. */
const CONTACTS: Array<{ id: string; firstname: string; lastname: string }> = [
  { id: DEMO_REVIEW_CONTACT_ID, firstname: 'Alex', lastname: 'Reviewer' },
  { id: `${DEMO_TEAM_ID}-c2`, firstname: 'Mira', lastname: 'Okafor' },
  { id: `${DEMO_TEAM_ID}-c3`, firstname: 'Jonas', lastname: 'Keller' },
  { id: `${DEMO_TEAM_ID}-c4`, firstname: 'Sofia', lastname: 'Rossi' },
  { id: `${DEMO_TEAM_ID}-c5`, firstname: 'Tomás', lastname: 'Ferreira' },
  { id: `${DEMO_TEAM_ID}-c6`, firstname: 'Amara', lastname: 'Diallo' },
]

const SUBSCRIPTION_TYPE_ID = `${DEMO_TEAM_ID}-sub-unlimited`

export interface ProvisionResult {
  teamId: string
  slug: string
  reviewContactId: string
  reviewEmail: string
  counts: { activities: number; sessions: number; contacts: number; bookings: number }
}

/**
 * Create or converge the demo tenant. Safe to run repeatedly: every document has
 * a deterministic id and is written with `set(..., { merge: true })`, so a second
 * run repairs rather than duplicates.
 *
 * Sessions are the exception — they are regenerated from today, so a tenant left
 * alone for a month still shows a live schedule. Stale ones are removed first.
 */
export async function provisionDemoTenant(nowMs: number = Date.now()): Promise<ProvisionResult> {
  const db = admin.firestore()

  // ── 1. Outbound messaging OFF, before anything can trigger a send ─────────
  // Written first on purpose. An absent policy resolves to MESSAGING_DEFAULT_MODE
  // which is `live` in production, and the very next writes create contacts and
  // bookings that triggers can react to.
  await db.collection('messaging_policies').doc(DEMO_TEAM_ID).set(
    {
      mode: 'silent',
      note: 'Linyup demo tenant (app-store review). Never sends.',
      updated_at: FieldValue.serverTimestamp(),
      updated_by: 'provisionDemoTenant',
    },
    { merge: true }
  )

  // ── 2. The team ───────────────────────────────────────────────────────────
  // First real write, so `onTeamCreated` (payment modes + the trial-cleanup
  // rule) and `syncTeamPublicProfile` (public_profile, which every public
  // surface reads) both fire.
  await db
    .collection(TEAMS_COLLECTION)
    .doc(DEMO_TEAM_ID)
    .set(
      {
        name: 'Linyup Demo Studio',
        slug: DEMO_SLUG,
        description: 'A sample studio used to demonstrate the Linyup app.',
        sport_type: 'fitness',
        default_currency: 'CHF',
        payment_modes: [...DEFAULT_PAYMENT_MODES],
        settings: {},
        links: [],
        // Studio tier so the reviewer sees the full feature set, `active` with
        // no Stripe subscription — `flags.internal` is the record of why there
        // is none, and exempts it from the trial sweep so it cannot lapse to
        // Free mid-review.
        plan: 'studio',
        plan_status: 'active',
        trial_ends_at: null,
        flags: { internal: true },
        // Deliberately absent: `payments`. No Connect account means
        // `payments_enabled` fails closed and every priced door stays shut.
        created: FieldValue.serverTimestamp(),
        createdBy: DEMO_OWNER_UID,
        primaryContact: DEMO_OWNER_UID,
        archived_at: null,
      },
      { merge: true }
    )

  await db
    .collection(TEAMS_COLLECTION)
    .doc(DEMO_TEAM_ID)
    .collection('team_members')
    .doc(DEMO_OWNER_UID)
    .set(
      { userId: DEMO_OWNER_UID, teamId: DEMO_TEAM_ID, role: 'owner', joined: FieldValue.serverTimestamp(), addedBy: DEMO_OWNER_UID },
      { merge: true }
    )

  // ── 3. What the studio offers ─────────────────────────────────────────────
  await db
    .collection(TEAMS_COLLECTION)
    .doc(DEMO_TEAM_ID)
    .collection(SUBSCRIPTION_TYPES_SUBCOLLECTION)
    .doc(SUBSCRIPTION_TYPE_ID)
    .set(
      {
        name: 'Unlimited Monthly',
        description: 'Come to everything.',
        source: 'internal',
        recurrence: 'monthly',
        price: 89,
        currency: 'CHF',
        active: true,
      },
      { merge: true }
    )

  for (const a of ACTIVITIES) {
    await db.collection(ACTIVITIES_COLLECTION).doc(a.id).set(
      {
        teamId: DEMO_TEAM_ID,
        name: a.name,
        slug: a.slug,
        color: a.color,
        description: a.description,
        type: 'class',
        ...(a.tags?.length ? { tags: a.tags } : {}),
        // Openly bookable: with no Connect account there is no price to charge,
        // so this is the only door that can work — and it is the one a reviewer
        // should be able to walk through.
        isFreeTrial: true,
        accessRule: { type: 'open' },
        max_participants: 12,
        archived_at: null,
        order: ACTIVITIES.indexOf(a),
      },
      { merge: true }
    )
  }

  // ── 4. The people ─────────────────────────────────────────────────────────
  for (const c of CONTACTS) {
    await db.collection(CONTACTS_COLLECTION).doc(c.id).set(
      {
        teamId: DEMO_TEAM_ID,
        firstname: c.firstname,
        lastname: c.lastname,
        // Synthetic by construction — `isSyntheticEmail()` drops these in every
        // environment, so the tenant cannot email anybody even if its policy is
        // deleted by hand.
        email: c.id === DEMO_REVIEW_CONTACT_ID ? DEMO_REVIEW_EMAIL : `${c.firstname.toLowerCase()}.${c.lastname.toLowerCase()}.${DEMO_TEAM_ID}@example.com`,
        phone: null,
        acquisition_stage: 'member',
        entry: 'manual',
        provisional: false,
        archived_at: null,
        deleted_at: null,
        created_at: FieldValue.serverTimestamp(),
        subscription_type_id: SUBSCRIPTION_TYPE_ID,
      },
      { merge: true }
    )
  }

  // ── 5. A live schedule, regenerated every run ─────────────────────────────
  // Sessions are the one thing that goes stale on the wall clock. Old demo
  // sessions are cleared first so a tenant provisioned months ago still opens on
  // a schedule with something in it.
  const existing = await db
    .collection(SESSIONS_COLLECTION)
    .where('teamId', '==', DEMO_TEAM_ID)
    .get()
  for (const d of existing.docs) await db.recursiveDelete(d.ref)

  let sessionCount = 0
  let bookingCount = 0
  const start = new Date(nowMs)
  start.setHours(0, 0, 0, 0)

  for (let offset = -7; offset <= 21; offset++) {
    const day = new Date(start.getTime() + offset * DAY_MS)
    for (const a of ACTIVITIES) {
      if (!a.days.includes(day.getDay())) continue
      const startsAt = new Date(day)
      startsAt.setHours(a.hour, 0, 0, 0)
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000)
      const sessionId = `${DEMO_TEAM_ID}-s-${a.slug}-${startsAt.toISOString().slice(0, 10)}`

      await db.collection(SESSIONS_COLLECTION).doc(sessionId).set({
        teamId: DEMO_TEAM_ID,
        activityId: a.id,
        activityName: a.name,
        activityColor: a.color,
        activityType: 'class',
        start: Timestamp.fromDate(startsAt),
        end: Timestamp.fromDate(endsAt),
        max_participants: 12,
        bookings_count: 0,
        participants_count: 0,
        location: 'Main studio',
        archived_at: null,
        created_at: FieldValue.serverTimestamp(),
      })
      sessionCount++

      // Give the reviewer a booking on the next few upcoming sessions, so their
      // own screens are not empty the moment they sign in.
      if (offset >= 0 && offset <= 7) {
        await db
          .collection(SESSIONS_COLLECTION)
          .doc(sessionId)
          .collection('bookings')
          .doc(DEMO_REVIEW_CONTACT_ID)
          .set({
            contact: DEMO_REVIEW_CONTACT_ID,
            teamId: DEMO_TEAM_ID,
            sessionId,
            status: 'confirmed',
            created_at: FieldValue.serverTimestamp(),
          })
        bookingCount++
        // ABSOLUTE, never an increment — the one-seat-writer rule. Each session
        // here has exactly one booking and is written once, so the count is
        // known rather than accumulated.
        await db.collection(SESSIONS_COLLECTION).doc(sessionId).set({ bookings_count: 1 }, { merge: true })
      }
    }
  }

  return {
    teamId: DEMO_TEAM_ID,
    slug: DEMO_SLUG,
    reviewContactId: DEMO_REVIEW_CONTACT_ID,
    reviewEmail: DEMO_REVIEW_EMAIL,
    counts: {
      activities: ACTIVITIES.length,
      sessions: sessionCount,
      contacts: CONTACTS.length,
      bookings: bookingCount,
    },
  }
}
