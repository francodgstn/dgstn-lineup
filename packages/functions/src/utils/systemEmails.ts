// Per-team on/off switches for SYSTEM-SENT member emails (transactional-ish mail
// the platform sends automatically, outside the automations engine). Studios that
// prefer full control via custom automations can turn these off from the
// Automations page ("System emails" panel). Stored on the team doc at
// settings.system_emails.{key}; absent ⇒ ENABLED.
//
// NOT covered here (by design). The test each of these passes: switching it off
// would not quieten the feature, it would BREAK it — the recipient is left
// stranded rather than merely uninformed.
//  • OTP / verification codes — auth-critical, always on
//  • the waitlist offer + join mails (booking/waitlist/notify.ts) — they carry
//    the only copy of the claim/entry token
//  • the PAID booking's receipt (booking/paidConfirmation.ts) — it is the
//    receipt, the manage-booking link and the only invitation into the member
//    area for someone who has already been charged. The FREE booking's
//    confirmation below stays switchable: that one is a courtesy a studio may
//    run itself. Free-is-switchable / paid-is-not is the design, not an
//    oversight — see that module's header before merging the two.
//  • a PAID appointment's confirmation (appointments/emails.ts) — the same rule
//    on the appointment rail, where one function serves both tenders and so
//    splits on its `wasPaidFor` argument rather than by module: paid ignores
//    `booking_confirmation`, free still obeys it. The tender is answered by the
//    caller that settled the booking (Connect webhook, staff cash rail), because
//    an offline settlement leaves no marker on the booking document to read.
//  • the SHOP purchase receipts (connect/purchaseReceipts.ts) — the same rule on
//    the rails that sell rather than book: a credit pack (the mail IS the
//    balance, and the number lives nowhere else the buyer can reach), a
//    membership, a course (the only thing that says where to watch it) and a
//    product (the only thing that says what happens next). Each has its OWN
//    template, because a course has no time or place and a pack's whole payload
//    is a number — reuse the posture and the mail_sends keying, not the body.
//  • the DESK receipts (payments/deskReceipt.ts) — outside the toggles for the
//    opposite reason to everything else on this list. They are not always-on:
//    the studio chooses per sale, on the dialog, in front of the person who just
//    paid, because a desk buyer has already been told something by a human. A
//    `SystemEmailKey` would move that decision into a settings page nobody opens
//    and turn a visible choice back into the silence UX-80 found. Bodies and
//    ledger keying are reused from connect/purchaseReceipts.ts; the POSTURE is
//    deliberately different, and the difference is the point.
//  • a session cancellation for a booking that was PAID for (sessions/index.ts)
//    — the `session_cancellation` toggle below still governs everybody else
//  • booking reminders — pre-existing toggle settings.bookingRemindersEnabled
//    (kept for back-compat; surfaced in the same UI panel)
//  • form submitter receipts — already opt-in per form (form.notifications)
//  • studio-facing notifications (new appointment/response/message) — not member mail
import * as admin from 'firebase-admin'

export type SystemEmailKey =
  | 'booking_confirmation' // class + appointment confirmations
  | 'session_cancellation' // session cancelled/changed notices to booked members
  | 'contact_update_review' // outcome email for a contact's data-update request

/** Sync check when the caller already holds the team doc data. Absent ⇒ enabled. */
export function systemEmailEnabled(
  teamData: FirebaseFirestore.DocumentData | null | undefined,
  key: SystemEmailKey
): boolean {
  const map = (teamData?.settings?.system_emails ?? {}) as Record<string, unknown>
  return map[key] !== false
}

/** Async check by teamId (one doc read) for call sites without the team doc in scope. */
export async function systemEmailEnabledFor(teamId: string, key: SystemEmailKey): Promise<boolean> {
  const snap = await admin.firestore().collection('teams').doc(teamId).get()
  return systemEmailEnabled(snap.data(), key)
}
