'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { functions } from '@/lib/firebase'
import { auth } from '@/lib/firebase-auth'
import { usePublicTeam } from '../PublicTeamProvider'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpaceContact {
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
  | { customToken: string; sessionExpires: string; contact: SpaceContact }

export type SpaceAuthStep = 'idle' | 'email' | 'code' | 'selectContact' | 'authenticated'

interface SpaceAuthContextValue {
  slug: string
  teamId: string
  step: SpaceAuthStep
  contact: SpaceContact | null
  isAuthenticated: boolean
  matchedContacts: MatchedContact[]
  requiresSignup: boolean
  signupEmail: string
  error: string | null
  /** Call to initiate the sign-in flow */
  openSignIn: () => void
  /** Cancel an in-progress sign-in flow (no-op once authenticated). */
  closeSignIn: () => void
  sendCode: (email: string) => Promise<void>
  verifyCode: (code: string) => Promise<void>
  selectContact: (contactId: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SpaceAuthContext = createContext<SpaceAuthContextValue | null>(null)

export function useSpaceAuth() {
  const ctx = useContext(SpaceAuthContext)
  if (!ctx) throw new Error('useSpaceAuth must be used inside SpaceAuthProvider')
  return ctx
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

const SESSION_KEY = 'linyup:space:session'

interface PersistedSession {
  contactId: string
  sessionExpires: string
  contact: SpaceContact
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

// The team is already resolved once by the parent PublicTeamProvider (the layout);
// this provider just layers the contact-session auth context on top for the whole
// Space (home + course player).
interface Props {
  slug: string
  children: ReactNode
}

export function SpaceAuthProvider({ slug, children }: Props) {
  const { teamId } = usePublicTeam()

  const [step, setStep] = useState<SpaceAuthStep>('idle')
  const [contact, setContact] = useState<SpaceContact | null>(null)
  const [matchedContacts, setMatchedContacts] = useState<MatchedContact[]>([])
  const [requiresSignup, setRequiresSignup] = useState(false)
  const [signupEmail, setSignupEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [codeId, setCodeId] = useState('')
  const [pendingCode, setPendingCode] = useState('')

  // Restore session on mount
  useEffect(() => {
    const session = loadSession()
    if (session) {
      setContact(session.contact)
      setStep('authenticated')
    }
  }, [])

  const openSignIn = useCallback(() => {
    setError(null)
    setRequiresSignup(false)
    setMatchedContacts([])
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
          'sendMembershipVerificationCode'
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
    [codeId]
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
    setError(null)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const value: SpaceAuthContextValue = {
    slug,
    teamId,
    step,
    contact,
    isAuthenticated: step === 'authenticated' && contact !== null,
    matchedContacts,
    requiresSignup,
    signupEmail,
    error,
    openSignIn,
    closeSignIn,
    sendCode,
    verifyCode,
    selectContact,
    logout,
    clearError,
  }

  return <SpaceAuthContext.Provider value={value}>{children}</SpaceAuthContext.Provider>
}
