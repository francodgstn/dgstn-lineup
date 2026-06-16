'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { collectionGroup, query, where, limit, getDocs } from 'firebase/firestore'
import { useTranslations } from 'next-intl'
import { functions, db } from '@/lib/firebase'
import { auth } from '@/lib/firebase-auth'

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

// Resolves the team by slug CLIENT-SIDE (the Firebase client SDK must not be used
// for server-side reads — see the bio-link pattern / CLAUDE.md), then provides the
// contact-session auth context to the whole Space (home + course player).
interface Props {
  slug: string
  children: ReactNode
}

type TeamStatus = 'loading' | 'found' | 'notfound'

export function SpaceAuthProvider({ slug, children }: Props) {
  const t = useTranslations('Space')

  const [teamId, setTeamId] = useState<string | null>(null)
  const [teamStatus, setTeamStatus] = useState<TeamStatus>('loading')

  const [step, setStep] = useState<SpaceAuthStep>('idle')
  const [contact, setContact] = useState<SpaceContact | null>(null)
  const [matchedContacts, setMatchedContacts] = useState<MatchedContact[]>([])
  const [requiresSignup, setRequiresSignup] = useState(false)
  const [signupEmail, setSignupEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [codeId, setCodeId] = useState('')
  const [pendingCode, setPendingCode] = useState('')

  // Resolve the team by slug (unauthenticated, public_profile collection group).
  useEffect(() => {
    let cancelled = false
    setTeamStatus('loading')
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('slug', '==', slug),
      where('type', '==', 'team'),
      limit(1)
    )
    getDocs(q)
      .then((snap) => {
        if (cancelled) return
        const resolved = snap.empty ? null : (snap.docs[0].ref.parent.parent?.id ?? null)
        if (resolved) {
          setTeamId(resolved)
          setTeamStatus('found')
        } else {
          setTeamStatus('notfound')
        }
      })
      .catch(() => {
        if (!cancelled) setTeamStatus('notfound')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

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

  const clearError = useCallback(() => setError(null), [])

  if (teamStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      </div>
    )
  }

  if (teamStatus === 'notfound' || !teamId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className="text-lg font-semibold">{t('notFound')}</p>
        <p className="text-sm text-muted-foreground">{t('notFoundDesc')}</p>
      </div>
    )
  }

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
    sendCode,
    verifyCode,
    selectContact,
    logout,
    clearError,
  }

  return <SpaceAuthContext.Provider value={value}>{children}</SpaceAuthContext.Provider>
}
