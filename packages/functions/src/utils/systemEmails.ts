// Per-team on/off switches for SYSTEM-SENT member emails (transactional-ish mail
// the platform sends automatically, outside the automations engine). Studios that
// prefer full control via custom automations can turn these off from the
// Automations page ("System emails" panel). Stored on the team doc at
// settings.system_emails.{key}; absent ⇒ ENABLED.
//
// NOT covered here (by design):
//  • OTP / verification codes — auth-critical, always on
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
