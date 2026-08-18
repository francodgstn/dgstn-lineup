'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { httpsCallable } from 'firebase/functions'
import { onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth'
import { functions } from '@/lib/firebase'
import { auth } from '@/lib/firebase-auth'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
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
  /** The contact's own address, as `buildContactSession` returns it. Optional
   *  because it is the contact's, not the mailbox that authenticated (a parent
   *  can verify with theirs and select a child), and because a session persisted
   *  by an older build may not carry one. Surfaces that name it — "sent to …" —
   *  must handle its absence rather than render `undefined`.
   *
   *  `| null` because that is what the server actually sends: `buildContactSession`
   *  returns `contactEmail ?? contactData.email ?? null`, so a contact with no
   *  address arrives as an explicit null, not as a missing key. Typing it away
   *  did not remove the null — it removed the compiler's knowledge of it, which
   *  is how `string | null` values end up flowing into props typed `string`. */
  email?: string | null
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
  /**
   * A session IS persisted and we have not finished checking it yet.
   *
   * Restoring takes two async hops — `onAuthStateChanged` (an IndexedDB read)
   * and then `getIdTokenResult` (which hits the network whenever the token
   * needs refreshing) — and for the whole of that window `isAuthenticated` is
   * false. Every gate that read it alone therefore GREETED A SIGNED-IN MEMBER
   * WITH "you are not signed in", on every single load of her own portal
   * (UX-37). It is not "signed out"; it is "not known yet", and the two must
   * render differently: a wall states a fact, and the fact was wrong.
   *
   * False for a first-time visitor — there is nothing to restore, so the
   * anonymous surfaces are never made to wait, and the sign-in prompt they
   * SHOULD show appears immediately.
   */
  isRestoring: boolean
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
  // Seeded SYNCHRONOUSLY from storage, so the first paint already knows whether
  // there is anything to wait for. An effect could not do this: the paint that
  // shows the wrong wall happens before it runs. The `window` guard is belt and
  // braces — PublicTeamProvider renders a spinner until it has resolved the team
  // client-side, so this provider never mounts on the server.
  const [restoring, setRestoring] = useState<boolean>(
    () => typeof window !== 'undefined' && loadSession() !== null
  )

  // Restore session on mount — but only once the UNDERLYING Firebase session is
  // confirmed. The localStorage flag alone used to flip the UI to "signed in"
  // even when the Firebase user was gone (e.g. an emulator restart wiped auth
  // state, or the browser's IndexedDB was cleared while localStorage survived),
  // and the mismatch only surfaced mid-checkout as a forced re-OTP. Verify the
  // Firebase user exists AND its contact claim matches the persisted session;
  // otherwise show signed-out so the user signs in BEFORE starting a purchase.
  useEffect(() => {
    const session = loadSession()
    if (!session) {
      setRestoring(false)
      return
    }
    // A BOUNDED WAIT. Everything below is asynchronous and one hop of it
    // (`getIdTokenResult`) can go to the network, where "slow" and "never" look
    // the same. Without a deadline a hung refresh leaves the portal spinning
    // with no way out; with one, the worst case is the OLD behaviour — the
    // sign-in prompt — arriving a few seconds later. Waiting is only ever
    // allowed to delay the answer, never to replace it.
    const deadline = setTimeout(() => setRestoring(false), 8000)
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe()
      if (!user) {
        clearSession()
        clearTimeout(deadline)
        setRestoring(false)
        return
      }
      void user
        .getIdTokenResult()
        .then((token) => {
          // BOTH halves of the identity, and the TOKEN is the authority for both.
          //
          // The storage key is global (one browser, one stored session), so a
          // contact signed in at studio A carries that session onto studio B's
          // public pages. Checking only `contactId` let the restore succeed
          // there: the surfaces then read `isAuthenticated`, suppress the guest
          // form, and act for a contact who belongs to a different tenant — up
          // to and including sending them mail from a studio they never joined.
          //
          // Gating on the CLAIM rather than on anything persisted also fixes
          // every session already in a browser: sessions predating this carry no
          // team of their own, and the claim has always been there.
          const sameContact = token.claims.contactId === session.contactId
          const sameTeam = token.claims.teamId === teamId
          if (sameContact && sameTeam) {
            setContact(session.contact)
            setStep('authenticated')
          } else {
            // Only drop the stored session when the CONTACT is wrong. A session
            // that is simply for another studio is still valid where it came
            // from, and clearing it here would sign the visitor out of their own
            // studio for having glanced at someone else's page.
            if (!sameContact) clearSession()
          }
        })
        .catch((err: unknown) => {
          // Token refresh failed (revoked/stale session) — treat as signed out.
          // Logged because "it keeps signing me out" is otherwise a report with
          // nothing behind it: this is the only place that decides it.
          reportPublicLoadFailure('contact-auth/token-refresh', err)
          clearSession()
        })
        // Whatever the answer, the WAITING is over — a `finally` rather than a
        // line in each branch, because a branch added later without one would
        // leave the portal spinning for a member with no way back.
        .finally(() => {
          clearTimeout(deadline)
          setRestoring(false)
        })
    })
    return () => {
      clearTimeout(deadline)
      unsubscribe()
    }
    // `teamId` is load-bearing here, not incidental: it is half of the identity
    // check above, and the provider is remounted per team by the route.
  }, [teamId])

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
    setRestoring(false)
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
    // Never both: once the session has landed there is nothing left to wait for,
    // so a consumer can read the two as an ordered pair (restoring → then the
    // answer) without having to know how the flag is cleared.
    isRestoring: restoring && step !== 'authenticated',
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
