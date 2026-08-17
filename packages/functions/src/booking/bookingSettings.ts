// THE store for a team's booking settings:
// `teams/{teamId}/public_profile/{teamId}.bookingSettings`. One document, one
// writer (Settings → Booking), every reader through here.
//
// It used to be two. The settings form wrote the public_profile doc AND mirrored
// the same object onto `teams/{id}.settings.booking`; the public booking page
// read the first, every booking callable read the second. The team doc is
// owner-only per firestore.rules, so a manager-role user's mirror write was
// denied while the public write succeeded — the public page hid late slots, the
// callables kept accepting them, and the form (which re-hydrated from the
// mirror) showed her the old value, so she believed she had never saved. The
// one setting whose entire purpose is to say *no* silently said yes (UX-6).
//
// The public_profile doc is world-readable and team-member writable, which is
// what makes it the right home: everyone who must read it can, and everyone who
// may edit booking can write it. `settings.booking` is GONE — not deprecated,
// not dual-read. If you find a reader of it, it is a bug, not a fallback.
//
// One extra document read per booking callable, on paths that already do
// several (session, activity, contact, team).

import * as admin from 'firebase-admin'
import { TEAMS_COLLECTION, type BookingSettings } from '@linyup/shared'

/** The team's world-readable public profile doc — id equals the team id. */
export const TEAM_PUBLIC_PROFILE_SUBCOLLECTION = 'public_profile'

export function teamPublicProfileRef(
  teamId: string
): FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData> {
  return admin
    .firestore()
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(TEAM_PUBLIC_PROFILE_SUBCOLLECTION)
    .doc(teamId)
}

/**
 * Narrow a public_profile document's data to its booking settings. Pure — pass
 * `snap.data()`, including from inside a transaction. A missing doc, a missing
 * field or a non-object value all mean "nothing configured", which every reader
 * already treats as today's defaults (no cutoff, no waitlist, 2-month window).
 */
export function bookingSettingsFrom(
  data: FirebaseFirestore.DocumentData | undefined
): Partial<BookingSettings> {
  const raw = data?.bookingSettings
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Partial<BookingSettings>)
    : {}
}

/** Read a team's booking settings. One document read. */
export async function loadBookingSettings(teamId: string): Promise<Partial<BookingSettings>> {
  const snap = await teamPublicProfileRef(teamId).get()
  return bookingSettingsFrom(snap.data())
}
