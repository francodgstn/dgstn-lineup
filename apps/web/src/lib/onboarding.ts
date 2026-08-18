import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'

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

/**
 * THE setup-checklist dismissal (UX-45). One flag, on the team doc, written
 * only here: `teams/{teamId}.setup_dismissed`. It is team-wide on purpose — a
 * studio finishes setting up once, not once per manager per browser.
 *
 * Writing it needs the `team.settings` capability (owner), which the callers
 * check; a manager's dismissal is local to their session and the card is back
 * on the next load. Reversible from How-to → "Setup checklist", which is the
 * only reason this is exported rather than inlined in the card.
 */
export async function setSetupDismissed(teamId: string, dismissed: boolean): Promise<void> {
  await updateDoc(doc(db, TEAMS_COLLECTION, teamId), { setup_dismissed: dismissed })
}

/** Re-arm the product tour so it shows again (e.g. "Restart tour" in settings). */
export async function resetTour(uid: string): Promise<void> {
  await setDoc(
    doc(db, 'users', uid),
    { onboarding: { tourDone: false, tourDoneAt: null } },
    { merge: true }
  )
}
