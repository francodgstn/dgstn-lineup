import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Helpers for reading/writing per-user onboarding progress
 * (`users/{uid}.onboarding`). Read the state from `useAuth().profile.onboarding`;
 * use these to mutate it. All writes are merge-writes so they never clobber the
 * rest of the profile.
 *
 * The product tour calls markTourDone / resetTour.
 *
 * The per-page section-intro popovers were removed in 2026-08 — the How-to page
 * does that job in one place and reaches every page, where the popovers reached
 * three and carried two competing "seen" flags between them.
 */

/** Mark the guided product tour as completed or skipped. */
export async function markTourDone(uid: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid),
    { onboarding: { tourDone: true, tourDoneAt: serverTimestamp() } },
    { merge: true }
  )
}

/** Re-arm the product tour so it shows again (e.g. "Restart tour" in settings). */
export async function resetTour(uid: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid),
    { onboarding: { tourDone: false, tourDoneAt: null } },
    { merge: true }
  )
}
