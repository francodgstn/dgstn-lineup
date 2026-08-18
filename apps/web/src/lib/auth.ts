import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  type User,
  type UserCredential,
} from 'firebase/auth'
import { auth } from './firebase-auth'

export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export async function signUp(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password)
}

export async function signOut() {
  return firebaseSignOut(auth)
}

export async function resetPassword(email: string) {
  return sendPasswordResetEmail(auth, email)
}

// ─── social providers ──────────────────────────────────────────────────────
// Each provider must also be enabled in the Firebase console (Authentication →
// Sign-in method) and, for production, the OAuth redirect domain authorised.
// The Auth emulator renders a fake account-picker popup so these work locally.

export type SocialProvider = 'google' | 'apple'

export async function signInWithProvider(which: SocialProvider): Promise<UserCredential> {
  switch (which) {
    case 'google': {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      return signInWithPopup(auth, provider)
    }
    case 'apple': {
      const provider = new OAuthProvider('apple.com')
      provider.addScope('email')
      provider.addScope('name')
      return signInWithPopup(auth, provider)
    }
  }
}

// ─── magic link (passwordless email) ─────────────────────────────────────────

const EMAIL_FOR_SIGNIN_KEY = 'linyup:emailForSignIn'

/** Send a passwordless sign-in link. The link returns the user to /auth/finish. */
export async function sendMagicLink(email: string): Promise<void> {
  const actionCodeSettings = {
    url: `${window.location.origin}/auth/finish`,
    handleCodeInApp: true,
  }
  await sendSignInLinkToEmail(auth, email, actionCodeSettings)
  // Stash the email so /auth/finish can complete sign-in without re-prompting
  // (the link may be opened on the same device/browser).
  window.localStorage.setItem(EMAIL_FOR_SIGNIN_KEY, email)
}

/** True if the current URL is a Firebase email sign-in link. */
export function isMagicLink(url: string): boolean {
  return isSignInWithEmailLink(auth, url)
}

/**
 * Complete a magic-link sign-in. Uses the stashed email if present, otherwise
 * falls back to a caller-provided email (link opened on a different device).
 */
export async function completeMagicLink(url: string, fallbackEmail?: string): Promise<UserCredential> {
  const email = window.localStorage.getItem(EMAIL_FOR_SIGNIN_KEY) ?? fallbackEmail
  if (!email) {
    throw new Error('missing-email')
  }
  const cred = await signInWithEmailLink(auth, email, url)
  window.localStorage.removeItem(EMAIL_FOR_SIGNIN_KEY)
  return cred
}

export type { User }
