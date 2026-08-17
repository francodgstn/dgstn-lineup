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
