// THE SIGNUP DOOR'S JOIN PROMOTION, for a contact that ALREADY EXISTS.
//
// `completeSignup` has three branches. The CREATE branch (no prior contact)
// stamps the birth facts — `acquisition_stage: 'joined'`, `converted_at`,
// `entry: 'signup'`. The two branches that finalize an EXISTING contact (matched
// by team+email, or named by a live contact session) deliberately wrote profile
// fields only: "never overwrite the birth facts it holds". That rule is right,
// and it had one hole — a contact can hold NO stage at all.
//
// Stage-less contacts are NORMAL and created on purpose, by every OFF-FUNNEL
// door (see `Contact.acquisition_stage` in @linyup/shared): a shop purchase
// (`connect/webhook.ts` → `resolveOrCreateContact`, `entry: 'shop'`), a shop
// registration (`auth/loginContactWithCode.ts`), a waitlist join, a public-form
// lead, a staff-created appointment client. "Absent" there means "not on the
// trial funnel", which is honest — a purchase is not a funnel milestone.
//
// But `joined` is not only an analytics milestone: it is the FIRST thing the
// paid-access gate asks. `resolveClassCoverage` (@linyup/shared
// `utils/paymentOptions.ts`) denies `not_joined` BEFORE it looks at any held
// subscription, so a stage-less contact is refused by every `members`-tier AND
// every `subscription`-tier class — even holding the exact subscription the
// class names. So someone could buy in the shop, later complete the public
// signup form, be matched by team+email, receive the welcome mail, and come out
// still not joined, with no self-serve way back (UX-82).
//
// ── THE RULE: FILL GAPS, OVERWRITE NOTHING ──────────────────────────────────
// A field the contact HOLDS is left exactly as it is. A field it does not hold
// is filled, because there is no birth fact there to protect. That is the whole
// decision, and it is why this is not a weakening of the old rule but the case
// the old rule never covered.
//
// "Holds" means present, NOT truthy. `acquisition_stage` is a closed union
// (`ACQUISITION_STAGES`), and absence is expressed exactly two ways: the key is
// missing (`undefined` — what every off-funnel door writes) or it is explicitly
// `null`. Anything else — including `''` and any value outside the union — is
// something the document HOLDS, so it is kept and reported rather than silently
// replaced with 'joined'. A `!stage` test would promote those, which is the
// difference between fixing a gap and overwriting data nobody looked at.
//
// ── WHAT `entry` AND `converted_at` SAY FOR A PURCHASE-FIRST CONTACT ────────
//   • `entry` is the door the person came through — an immutable birth fact and
//     the studio's attribution. A shop buyer's is 'shop', and it STAYS 'shop':
//     they really did arrive by buying, and rewriting it to 'signup' would erase
//     the only record of how they were acquired. 'signup' is written only when
//     the contact carries no entry at all (nothing to overwrite).
//   • `converted_at` is WHEN they joined — now, the moment they completed the
//     signup form, not when they paid. Buying was not the join (that is exactly
//     why the webhook leaves the funnel alone); completing signup is. An
//     already-held `converted_at` (e.g. a studio backdating an imported member)
//     is kept.
// `acquisition_stage_updated_at` is not a birth fact — it records THIS write —
// so it is always stamped alongside the stage.
//
// Pure and injectable so the invariants above are pinned by name in
// `signupJoin.test.ts` (the sentinel factory keeps `FieldValue` at the call
// site, where the Firestore write is).
import { ACQUISITION_STAGES } from '@linyup/shared'

/** The subset of the existing contact this decision reads. */
export interface SignupJoinSubject {
  acquisition_stage?: unknown
  converted_at?: unknown
  entry?: unknown
}

export type SignupJoinReason =
  /** Carried no stage — the three fields below were filled. */
  | 'promoted'
  /** Holds a real `AcquisitionStage`; left untouched (the birth-fact rule). */
  | 'holds_stage'
  /** Holds something outside the union (incl. `''`); left untouched, and worth
   *  a log line — it is data nobody meant to write. */
  | 'holds_unrecognised_stage'

export interface SignupJoinPromotion {
  /** Fields to MERGE onto the existing contact. Empty ⇒ nothing to fill. */
  patch: Record<string, unknown>
  reason: SignupJoinReason
}

/** Absent = the key is missing, or it is explicitly null. Nothing else. */
function absent(value: unknown): boolean {
  return value === undefined || value === null
}

export function resolveSignupJoinPromotion(
  existing: SignupJoinSubject | null | undefined,
  serverTimestamp: () => unknown
): SignupJoinPromotion {
  const stage = existing?.acquisition_stage
  if (!absent(stage)) {
    return {
      patch: {},
      reason: (ACQUISITION_STAGES as readonly unknown[]).includes(stage)
        ? 'holds_stage'
        : 'holds_unrecognised_stage',
    }
  }
  const patch: Record<string, unknown> = {
    acquisition_stage: 'joined',
    acquisition_stage_updated_at: serverTimestamp(),
  }
  if (absent(existing?.converted_at)) patch.converted_at = serverTimestamp()
  if (absent(existing?.entry)) patch.entry = 'signup'
  return { patch, reason: 'promoted' }
}
