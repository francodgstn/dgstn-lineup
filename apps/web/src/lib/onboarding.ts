import { doc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore'
import { db } from './firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'

/**
 * Helpers for reading/writing per-user onboarding progress
 * (`users/{uid}.onboarding`). Read the state from `useAuth().profile.onboarding`;
 * use these to mutate it. All writes are merge-writes so they never clobber the
 * rest of the profile.
 *
 * The product tour that called markTourDone / resetTour was removed on
 * 2026-08-23 — see the note on the user menu's setup entry. Those two helpers
 * went with it; `users/{uid}.onboarding.tourDone` survives on existing profiles
 * as inert data, which is cheaper to leave than to migrate away.
 *
 * The per-page section-intro popovers were removed in 2026-08 — the How-to page
 * does that job in one place and reaches every page, where the popovers reached
 * three and carried two competing "seen" flags between them.
 */

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

/**
 * Close a setup step as "not needed", or reopen it.
 *
 * DELIBERATELY NOT the same as done. A cash-only club that closes the payments
 * step has not set up payments and the guide does not claim they have — the
 * step is drawn as acknowledged, not completed. The distinction is what keeps
 * this from being a "mark everything green" button.
 *
 * Reopening deletes the key rather than storing false, so `setup_ack` only ever
 * holds decisions somebody actually made.
 */
export async function setSetupStepAcknowledged(
  teamId: string,
  key: string,
  acknowledged: boolean
): Promise<void> {
  await updateDoc(doc(db, TEAMS_COLLECTION, teamId), {
    [`setup_ack.${key}`]: acknowledged ? serverTimestamp() : deleteField(),
  })
}
