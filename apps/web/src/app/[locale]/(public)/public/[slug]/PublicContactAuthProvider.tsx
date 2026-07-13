'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { httpsCallable } from 'firebase/functions'
import { onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth'
import { functions } from '@/lib/firebase'
import { auth } from '@/lib/firebase-auth'
import { usePublicTeam } from './PublicTeamProvider'

// The passwordless CONTACT-SESSION auth, lifted from Space to the team root so it
// wraps EVERY public surface (bio-link, booking, signup, documents, shop, space).
// The Firebase custom-token session was already global; this makes the React
// context + sign-in flow available everywhere, so any surface can show login state,
// offer sign-in, and read the signed-in contact. Space consumes it via a back-compat
// shim (space/SpaceAuthProvider re-exports usePublicContactAuth as useSpaceAuth).

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PublicContact {
  id: string
  firstname: string
  lastname: string
  subscription_type_id?: string
}

export interface MatchedContact {
  id: string
  firstname: string
  lastname: string
}

type LoginResult =
  | { requiresSignup: true; email: string }
  | { requiresContactSelection: true; email: string; matchedContacts: MatchedContact[] }
  | { customToken: string; sessionExpires: string; contact: PublicContact }

export type PublicContactAuthStep =
  | 'idle'
  | 'email'
  | 'code'
  | 'selectContact'
  | 'register'
  | 'authenticated'

interface PublicContactAuthContextValue {
  slug: string
  teamId: string
  step: PublicContactAuthStep
  contact: PublicContact | null
  isAuthenticated: boolean
  matchedContacts: MatchedContact[]
  requiresSignup: boolean
  signupEmail: string
  /** Whether this sign-in flow may CREATE a minimal contact for an unknown email
   *  (login-first checkout). Off by default — Space & co. keep the signup link. */
  allowRegistration: boolean
  error: string | null
  /** Call to initiate the sign-in flow */
  openSignIn: (options?: { allowRegistration?: boolean }) => void
  /** Cancel an in-progress sign-in flow (no-op once authenticated). */
  closeSignIn: () => void
  sendCode: (email: string) => Promise<void>
  verifyCode: (code: string) => Promise<void>
  selectContact: (contactId: string) => Promise<void>
  /** Register a minimal new contact for the OTP-verified email (register step). */
  registerContact: (firstname: string, lastname: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PublicContactAuthContext = createContext<PublicContactAuthContextValue | null>(null)

export function usePublicContactAuth() {
  const ctx = useContext(PublicContactAuthContext)
  if (!ctx) throw new Error('usePublicContactAuth must be used inside PublicContactAuthProvider')
  return ctx
}

// ─── Storage helpers ─────────────────────────────────────────────────────────
// Key kept stable ('space' era) so existing sessions survive the lift.

const SESSION_KEY = 'linyup:space:session'

interface PersistedSession {
  contactId: string
  sessionExpires: string
  contact: PublicContact
}

function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedSession
    if (new Date(parsed.sessionExpires) < new Date()) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveSession(data: PersistedSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(data))
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

// ─── Provider ────────────────────────────────────────────────────────────────

// Mounted once at the team root (inside PublicTeamProvider), so slug + teamId come
// from there rather than props.
export function PublicContactAuthProvider({ children }: { children: ReactNode }) {
  const { slug, teamId } = usePublicTeam()

  const [step, setStep] = useState<PublicContactAuthStep>('idle')
  const [contact, setContact] = useState<PublicContact | null>(null)
  const [matchedContacts, setMatchedContacts] = useState<MatchedContact[]>([])
  const [requiresSignup, setRequiresSignup] = useState(false)
  const [signupEmail, setSignupEmail] = useState('')
  const [allowRegistration, setAllowRegistration] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeId, setCodeId] = useState('')
  const [pendingCode, setPendingCode] = useState('')

  // Restore session on mount — but only once the UNDERLYING Firebase session is
  // confirmed. The localStorage flag alone used to flip the UI to "signed in"
  // even when the Firebase user was gone (e.g. an emulator restart wiped auth
  // state, or the browser's IndexedDB was cleared while localStorage survived),
  // and the mismatch only surfaced mid-checkout as a forced re-OTP. Verify the
  // Firebase user exists AND its contact claim matches the persisted session;
  // otherwise show signed-out so the user signs in BEFORE starting a purchase.
  useEffect(() => {
    const session = loadSession()
    if (!session) return
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe()
      if (!user) {
        clearSession()
        return
      }
      void user
        .getIdTokenResult()
        .then((token) => {
          if (token.claims.contactId === session.contactId) {
            setContact(session.contact)
            setStep('authenticated')
          } else {
            clearSession()
          }
        })
        .catch(() => {
          // Token refresh failed (revoked/stale session) — treat as signed out.
          clearSession()
        })
    })
    return unsubscribe
  }, [])

  const openSignIn = useCallback((options?: { allowRegistration?: boolean }) => {
    setError(null)
    setRequiresSignup(false)
    setMatchedContacts([])
    setAllowRegistration(options?.allowRegistration === true)
    setStep('email')
  }, [])

  const sendCode = useCallback(
    async (email: string) => {
      setError(null)
      if (!teamId) {
        setError('Team not loaded yet. Please try again.')
        return
      }
      try {
        const fn = httpsCallable<{ email: string; teamId: string }, { codeId: string }>(
          functions,
          'sendContactVerificationCode'
        )
        const result = await fn({ email, teamId })
        setCodeId(result.data.codeId)
        setPendingCode('')
        setStep('code')
      } catch (err: unknown) {
        const e = err as { message?: string }
        setError(e.message ?? 'Failed to send code.')
      }
    },
    [teamId]
  )

  const verifyCode = useCallback(
    async (code: string) => {
      setError(null)
      try {
        const fn = httpsCallable<{ codeId: string; code: string }, LoginResult>(
          functions,
          'loginContactWithCode'
        )
        const result = await fn({ codeId, code })
        const data = result.data

        if ('requiresSignup' in data && data.requiresSignup) {
          setSignupEmail(data.email)
          setRequiresSignup(true)
          // Keep the verified code around: the register step re-submits it together
          // with the minimal profile (same second-call pattern as selectContact).
          setPendingCode(code)
          if (allowRegistration) setStep('register')
          return
        }

        if ('requiresContactSelection' in data && data.requiresContactSelection) {
          setMatchedContacts(data.matchedContacts)
          setPendingCode(code)
          setStep('selectContact')
          return
        }

        if ('customToken' in data) {
          await signInWithCustomToken(auth, data.customToken)
          const session: PersistedSession = {
            contactId: data.contact.id,
            sessionExpires: data.sessionExpires,
            contact: data.contact,
          }
          saveSession(session)
          setContact(data.contact)
          setStep('authenticated')
        }
      } catch (err: unknown) {
        const e = err as { message?: string }
        setError(e.message ?? 'Incorrect code.')
      }
    },
    [codeId, allowRegistration]
  )

  const selectContact = useCallback(
    async (contactId: string) => {
      setError(null)
      try {
        const fn = httpsCallable<
          { codeId: string; code: string; selectedContactId: string },
          LoginResult
        >(functions, 'loginContactWithCode')
        const result = await fn({ codeId, code: pendingCode, selectedContactId: contactId })
        const data = result.data

        if ('customToken' in data) {
          await signInWithCustomToken(auth, data.customToken)
          const session: PersistedSession = {
            contactId: data.contact.id,
            sessionExpires: data.sessionExpires,
            contact: data.contact,
          }
          saveSession(session)
          setContact(data.contact)
          setStep('authenticated')
        }
      } catch (err: unknown) {
        const e = err as { message?: string }
        setError(e.message ?? 'Could not sign in.')
      }
    },
    [codeId, pendingCode]
  )

  // Login-first shop registration: the OTP already proved email ownership; submit
  // the SAME verified code again with the minimal profile — the callable creates a
  // provisional contact and mints the session in one step.
  const registerContact = useCallback(
    async (firstname: string, lastname: string) => {
      setError(null)
      try {
        const fn = httpsCallable<
          { codeId: string; code: string; newContact: { firstname: string; lastname: string } },
          LoginResult
        >(functions, 'loginContactWithCode')
        const result = await fn({
          codeId,
          code: pendingCode,
          newContact: { firstname: firstname.trim(), lastname: lastname.trim() },
        })
        const data = result.data

        if ('customToken' in data) {
          await signInWithCustomToken(auth, data.customToken)
          const session: PersistedSession = {
            contactId: data.contact.id,
            sessionExpires: data.sessionExpires,
            contact: data.contact,
          }
          saveSession(session)
          setContact(data.contact)
          setRequiresSignup(false)
          setStep('authenticated')
        }
      } catch (err: unknown) {
        // Surfaces the server copy (cap blocked / registration budget / expired code).
        const e = err as { message?: string }
        setError(e.message ?? 'Could not create your account.')
      }
    },
    [codeId, pendingCode]
  )

  const logout = useCallback(async () => {
    clearSession()
    setContact(null)
    setStep('idle')
    setMatchedContacts([])
    setRequiresSignup(false)
    setError(null)
    try {
      await signOut(auth)
    } catch {
      // ignore
    }
  }, [])

  const closeSignIn = useCallback(() => {
    // Reset the transient sign-in flow without signing an authenticated user out.
    setStep((s) => (s === 'authenticated' ? s : 'idle'))
    setMatchedContacts([])
    setRequiresSignup(false)
    setAllowRegistration(false)
    setError(null)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const value: PublicContactAuthContextValue = {
    slug,
    teamId,
    step,
    contact,
    isAuthenticated: step === 'authenticated' && contact !== null,
    matchedContacts,
    requiresSignup,
    signupEmail,
    allowRegistration,
    error,
    openSignIn,
    closeSignIn,
    sendCode,
    verifyCode,
    selectContact,
    registerContact,
    logout,
    clearError,
  }

  return <PublicContactAuthContext.Provider value={value}>{children}</PublicContactAuthContext.Provider>
}
