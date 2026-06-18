import { beforeUserCreated, HttpsError } from 'firebase-functions/v2/identity'
import * as admin from 'firebase-admin'
import {
  APP_SETTINGS_COLLECTION,
  PUBLIC_SETTINGS_DOC,
  SIGNUP_ALLOWLIST_COLLECTION,
  normalizeEmail,
  type PublicAppSettings,
} from '@linyup/shared'

/**
 * Decides whether a brand-new account may be created. Pure-ish (takes the db so
 * it can be unit-tested with a mock). Logic:
 *   1. An allowlisted email may ALWAYS sign up (covers users invited by the
 *      operator while public signup is closed).
 *   2. Otherwise gate on the world-readable public flag, read FRESH every time
 *      (never the cached getAppSettings) and FAIL CLOSED — a missing/false flag
 *      or any read error blocks signup, the safe default for the limited launch.
 *
 * @param email already normalized (or null when the provider gives no email)
 */
export async function isSignupAllowed(
  db: admin.firestore.Firestore,
  email: string | null,
): Promise<boolean> {
  if (email) {
    const entry = await db.collection(SIGNUP_ALLOWLIST_COLLECTION).doc(email).get()
    if (entry.exists) return true
  }

  try {
    const snap = await db.collection(APP_SETTINGS_COLLECTION).doc(PUBLIC_SETTINGS_DOC).get()
    return (
      snap.exists &&
      (snap.data() as PublicAppSettings | undefined)?.public_signup_enabled === true
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('beforeSignup: failed to read public signup flag — failing closed', err)
    return false
  }
}

// Firebase Auth blocking function — the SINGLE server-side gate that catches
// every new-account method (email/password, Google/Apple/Facebook first-use,
// magic link). Throwing rejects the signup before the account exists. We do NOT
// add beforeUserSignedIn, so existing users can always log in.
//
// region: a blocking function runs only at signup (rare), so region is about
// deploy compatibility + Firestore locality, not latency. Kept on europe-west6
// to match the rest of the stack and the database. If a deploy ever rejects this
// region for blocking functions, fall back to 'us-central1'.
export const beforeSignup = beforeUserCreated({ region: 'europe-west6' }, async (event) => {
  const db = admin.firestore()
  const email = event.data?.email ? normalizeEmail(event.data.email) : null

  if (!(await isSignupAllowed(db, email))) {
    // Stable code the web app maps to localized "invite-only" copy.
    throw new HttpsError('permission-denied', 'signup-closed')
  }
  // allowed → return undefined (no mutation of the new user)
})
