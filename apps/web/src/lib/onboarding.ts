import { doc, setDoc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Helpers for reading/writing per-user onboarding progress
 * (`users/{uid}.onboarding`). Read the state from `useAuth().profile.onboarding`;
 * use these to mutate it. All writes are merge-writes so they never clobber the
 * rest of the profile.
 *
 * Phase 3 (product tour) calls markTourDone / resetTour.
 * Phase 4 (section intro panels) calls markIntroSeen with a section key.
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

/** Record that the user has seen a given section's intro panel. */
export async function markIntroSeen(uid: string, sectionKey: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid),
    { onboarding: { seenIntros: arrayUnion(sectionKey) } },
    { merge: true }
  )
}
