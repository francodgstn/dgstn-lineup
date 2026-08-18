// THE SIGNUP DOOR'S JOIN PROMOTION, for a contact that ALREADY EXISTS.
//
// ── THE RULE: COMPLETING THE SIGNUP FORM IS THE ACT OF JOINING ──────────────
// The public signup form IS the declaration of joining, so finishing it moves
// the contact to `acquisition_stage: 'joined'` — from NO stage, and from any
// earlier funnel stage. The trial stages exist to track leads who have *not*
// signed up; once someone has, `trial_booked` is no longer a description of
// them, it is a stale one. (UX-83, Franco's decision. The narrower earlier rule
// — promote only a contact holding no stage at all — is UX-82, and it is the
// case this one contains.)
//
// This is not a weakening of the "never overwrite a birth fact" rule that
// guards `entry` and `converted_at`: the ACQUISITION STAGE is not a birth fact.
// It is a high-water funnel POSITION that is supposed to advance on the event
// that advances it, and completing signup is exactly such an event. `entry` and
// `converted_at` keep the fill-gaps-overwrite-nothing rule below, unchanged.
//
// Why it matters beyond the funnel: `joined` is the FIRST thing the paid-access
// gate asks. `resolveClassCoverage` (@linyup/shared `utils/paymentOptions.ts`)
// denies `not_joined` BEFORE it looks at any held subscription, so a contact
// that is stage-less OR still on a trial stage is refused by every
// `members`-tier AND every `subscription`-tier class — even holding the exact
// subscription the class names. Two ordinary paths ended there, permanently,
// with no self-serve way out:
//   • buy in the shop, then complete signup (UX-82) — the contact was created
//     off-funnel by `connect/webhook.ts` → `resolveOrCreateContact`, with an
//     `entry` and no stage;
//   • book a trial or a drop-in, then complete signup (UX-83) — the contact was
//     created at `trial_booked` by the booking doors (`appointments/booking.ts`,
//     `booking/dropIn.ts`, `booking/index.ts`), which is the single most common
//     way a person enters a studio. The public card says "Members only —
//     signing up is free"; before this, signing up did not make them a member.
//
// ── NEVER BACKWARDS: `joined` IS TERMINAL ───────────────────────────────────
// The funnel is high-water and one-way. A contact at `joined` is left EXACTLY
// as it is — no re-stamped timestamp, no patch at all — so a member who fills
// the form again (or a studio re-sending them through it) loses nothing. The
// test is by RANK in `ACQUISITION_STAGES`, not equality with 'joined', so the
// reserved downstream stages ('left' | 'won_back', see `Contact`) would also be
// left alone rather than dragged back to 'joined' the day they ship.
//
// ── A VALUE OUTSIDE THE UNION IS REPORTED, NOT REPAIRED ─────────────────────
// "Absent" means the key is missing (`undefined` — what every off-funnel door
// writes) or explicitly `null`. Nothing else. Anything the document HOLDS that
// is not in `ACQUISITION_STAGES` — including `''` — cannot be ranked, so it
// cannot be advanced without guessing: it is left untouched and reported
// (`holds_unrecognised_stage`, which the caller logs as a warning). It is data
// nobody meant to write, and overwriting it silently would destroy the only
// evidence of that. A `!stage` test would promote those, which is the
// difference between advancing a funnel and overwriting data nobody looked at.
//
// ── WHAT `entry` AND `converted_at` DO (fill gaps, overwrite nothing) ───────
//   • `entry` is the door the person came through — an immutable birth fact and
//     the studio's attribution. A shop buyer's is 'shop' and a trial lead's is
//     'booking', and both STAY: they really did arrive that way, and rewriting
//     either to 'signup' would erase the only record of how they were acquired.
//     'signup' is written only when the contact carries no entry at all.
//   • `converted_at` is WHEN they joined — now, the moment they completed the
//     form, not when they paid or booked a trial. A trial lead normally holds
//     none (the web clears it on any correction back below 'joined', and no
//     trial door writes one), so this is a genuine first stamp at the real
//     conversion moment. One that IS held was put there deliberately by a human
//     — a studio backdating an imported member, or editing the milestone on the
//     contact profile — so it wins, as it does everywhere else.
// `acquisition_stage_updated_at` is not a birth fact — it records THIS write —
// so it is always stamped alongside the stage.
//
// ── THE ANALYTICS ASYMMETRY IS DELIBERATE ───────────────────────────────────
// `trackContacts` (`analytics/index.ts`) logs `acquisition_stage_change` and
// increments `trial_conversions_count` only when BOTH sides of the change are
// present. So:
//   • `trial_booked | trial_attended → joined` DOES write a conversion row and
//     DOES increment the weekly tally. Correct: that is precisely what a trial
//     conversion is, and until now these were invisible because the promotion
//     never happened.
//   • absent → `joined` writes NEITHER. Also correct: a shop buyer or a captured
//     lead was never on the trial funnel, so counting them as a trial conversion
//     would inflate the number the studio judges its trial offer by.
// It looks like an inconsistency read cold; it is one rule (count a movement
// ALONG the funnel, not an entry INTO it) seen from two doors. Pinned by name
// in `signupJoin.test.ts` → "the analytics consequence".
// Automation is deliberately NOT symmetric with analytics: `onContactWrite`
// ranks an absent stage at -1, so BOTH cases fire `acquisition_stage_changed`
// (a forward move). That is what a "when someone joins" rule should do — it is
// about the person joining, not about the funnel arithmetic.
//
// Pure and injectable so the invariants above are pinned by name in
// `signupJoin.test.ts` (the sentinel factory keeps `FieldValue` at the call
// site, where the Firestore write is).
import { ACQUISITION_STAGES, type AcquisitionStage } from '@linyup/shared'

/** The subset of the existing contact this decision reads. */
export interface SignupJoinSubject {
  acquisition_stage?: unknown
  converted_at?: unknown
  entry?: unknown
}

export type SignupJoinReason =
  /** Carried NO stage (an off-funnel door: shop / form / waitlist / staff).
   *  Promoted. Analytics counts nothing — they were never on the funnel. */
  | 'promoted_from_none'
  /** Held an earlier funnel stage (today: `trial_booked` / `trial_attended`).
   *  Promoted, and this one IS a trial conversion — analytics counts it. */
  | 'promoted_from_stage'
  /** Already at `joined` (or, one day, past it). Untouched: never backwards. */
  | 'already_joined'
  /** Holds something outside the union (incl. `''`) — unrankable, so left
   *  untouched, and worth a log line: it is data nobody meant to write, and
   *  paid access will keep refusing it until a human looks. */
  | 'holds_unrecognised_stage'

export interface SignupJoinPromotion {
  /** Fields to MERGE onto the existing contact. Empty ⇒ nothing to change. */
  patch: Record<string, unknown>
  reason: SignupJoinReason
  /** The stage held before this decision, for the caller's log line. `null`
   *  when absent; the raw value when unrecognised. */
  from: unknown
}

/** Absent = the key is missing, or it is explicitly null. Nothing else. */
function absent(value: unknown): boolean {
  return value === undefined || value === null
}

const JOINED_RANK = ACQUISITION_STAGES.indexOf('joined' as AcquisitionStage)

export function resolveSignupJoinPromotion(
  existing: SignupJoinSubject | null | undefined,
  serverTimestamp: () => unknown
): SignupJoinPromotion {
  const stage = existing?.acquisition_stage
  const held = !absent(stage)
  if (held) {
    const rank = (ACQUISITION_STAGES as readonly unknown[]).indexOf(stage)
    if (rank < 0) return { patch: {}, reason: 'holds_unrecognised_stage', from: stage }
    // High-water: at or past 'joined' there is nothing to advance, and moving
    // anyone back to it would be a regression.
    if (rank >= JOINED_RANK) return { patch: {}, reason: 'already_joined', from: stage }
  }
  const patch: Record<string, unknown> = {
    acquisition_stage: 'joined',
    acquisition_stage_updated_at: serverTimestamp(),
  }
  if (absent(existing?.converted_at)) patch.converted_at = serverTimestamp()
  if (absent(existing?.entry)) patch.entry = 'signup'
  return {
    patch,
    reason: held ? 'promoted_from_stage' : 'promoted_from_none',
    from: held ? stage : null,
  }
}
