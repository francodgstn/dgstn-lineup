'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { collectionGroup, getDocs, limit, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2 } from 'lucide-react'
import type { FormPublicProfile, FormAccess } from '@linyup/shared'
import { FieldInput } from '@/components/forms/FieldInput'
import { usePublicTeam } from '../../PublicTeamProvider'
import { useSpaceAuth } from '../../space/SpaceAuthProvider'

// ─── Form loader ────────────────────────────────────────────────────────────

type LoadState =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'ready'; formId: string; profile: FormPublicProfile }

function usePublicForm(teamId: string, formSlug: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDocs(
          query(
            collectionGroup(db, 'public_profile'),
            where('teamId', '==', teamId),
            where('type', '==', 'form'),
            where('slug', '==', formSlug),
            limit(1),
          ),
        )
        if (cancelled) return
        if (snap.empty) {
          setState({ status: 'notfound' })
          return
        }
        const doc = snap.docs[0]
        setState({ status: 'ready', formId: doc.id, profile: doc.data() as FormPublicProfile })
      } catch (err: unknown) {
        reportPublicLoadFailure('forms/resolve-slug', err)
        if (!cancelled) setState({ status: 'notfound' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [teamId, formSlug])
  return state
}

// ─── Contacts-only sign-in gate ────────────────────────────────────────────────

function ContactsGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('CustomForms')
  const auth = useSpaceAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  if (auth.isAuthenticated) return <>{children}</>

  return (
    <div className="rounded-lg border bg-muted/30 p-5 space-y-3">
      <p className="text-sm font-medium">{t('signInRequired')}</p>
      {auth.error && <p className="text-sm text-destructive">{auth.error}</p>}
      {auth.step === 'idle' && (
        <Button onClick={() => auth.openSignIn()}>{t('signIn')}</Button>
      )}
      {auth.step === 'email' && (
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button onClick={() => auth.sendCode(email)} disabled={!email}>{t('sendCode')}</Button>
        </div>
      )}
      {auth.step === 'code' && (
        <div className="flex gap-2">
          <Input
            placeholder={t('codePlaceholder')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button onClick={() => auth.verifyCode(code)} disabled={!code}>{t('verify')}</Button>
        </div>
      )}
      {auth.step === 'selectContact' && (
        <div className="space-y-1.5">
          {auth.matchedContacts.map((c) => (
            <Button key={c.id} variant="outline" className="w-full justify-start" onClick={() => auth.selectContact(c.id)}>
              {c.firstname} {c.lastname}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Form view ─────────────────────────────────────────────────────────────────

function FormView({ formSlug }: { formSlug: string }) {
  const t = useTranslations('CustomForms')
  const { teamId, team } = usePublicTeam()
  const state = usePublicForm(teamId, formSlug)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const profile = state.status === 'ready' ? state.profile : null
  const sortedFields = useMemo(
    () => (profile?.fields ?? []).slice().sort((a, b) => a.order - b.order),
    [profile?.fields],
  )

  if (state.status === 'loading') return <Skeleton className="h-72 w-full max-w-xl" />
  if (state.status === 'notfound') {
    return <p className="text-sm text-muted-foreground">{t('formNotFound')}</p>
  }

  const submit = async () => {
    setError(null)
    // Client-side required validation (server re-validates).
    for (const f of sortedFields) {
      const v = answers[f.id]
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0)
      if (f.required && empty) {
        setError(t('missingRequired', { label: f.label }))
        return
      }
    }
    setSubmitting(true)
    try {
      const fn = httpsCallable(functions, 'submitForm')
      await fn({ teamId, formId: state.formId, answers })
      setDone(true)
    } catch (err) {
      setError((err as { message?: string }).message ?? t('submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-xl rounded-lg border bg-card p-8 text-center space-y-2">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <p className="font-medium">{t('thankYou')}</p>
        <p className="text-sm text-muted-foreground">{t('thankYouBody')}</p>
      </div>
    )
  }

  const body = (
    <div className="space-y-4">
      {sortedFields.map((field) => (
        <div key={field.id} className="space-y-1.5">
          {field.type !== 'checkbox' && (
            <Label>
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </Label>
          )}
          <FieldInput
            field={field}
            value={answers[field.id]}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [field.id]: v }))}
          />
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={submit} disabled={submitting}>
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </div>
  )

  return (
    <div className="mx-auto max-w-xl py-8 px-4 space-y-5">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{team?.name}</p>
        <h1 className="text-2xl font-semibold">{profile!.title}</h1>
        {profile!.description && <p className="text-muted-foreground">{profile!.description}</p>}
      </div>
      {(profile!.access as FormAccess) === 'contacts' ? <ContactsGate>{body}</ContactsGate> : body}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PublicFormPage() {
  const params = useParams()
  const formSlug = String(params.formSlug)
  // Contact-session auth is now provided at the team root (PublicContactAuthProvider),
  // so this page just renders the form — no local provider needed.
  return <FormView formSlug={formSlug} />
}
