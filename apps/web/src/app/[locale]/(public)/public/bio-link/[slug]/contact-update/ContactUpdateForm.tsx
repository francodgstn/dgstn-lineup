'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { collectionGroup, query, where, limit, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { BioLinkShell, BioLinkButton } from '../BioLinkShell'

// ─── steps ───────────────────────────────────────────────────────────────────

type Step = 'loading' | 'not-found' | 'email' | 'code' | 'form' | 'success'

// ─── schemas ─────────────────────────────────────────────────────────────────

const emailSchema = z.object({
  email: z.string().email('Invalid email address'),
})

const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

const detailsSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  phone: z.string().max(30).optional(),
  birthdate: z.string().optional(),
  note: z.string().max(500).optional(),
})

type EmailValues = z.infer<typeof emailSchema>
type CodeValues = z.infer<typeof codeSchema>
type DetailsValues = z.infer<typeof detailsSchema>

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  slug: string
  contactId: string
}

export default function ContactUpdateForm({ slug, contactId }: Props) {
  const [step, setStep] = useState<Step>('loading')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')
  const [accentColor, setAccentColor] = useState<string | null>(null)
  const [showBranding, setShowBranding] = useState(false)
  const [email, setEmail] = useState('')
  const [codeId, setCodeId] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Resolve team from public_profile
  useEffect(() => {
    const resolve = async () => {
      try {
        const snap = await getDocs(
          query(
            collectionGroup(db, 'public_profile'),
            where('slug', '==', slug),
            where('type', '==', 'team'),
            limit(1)
          )
        )
        if (snap.empty) {
          setStep('not-found')
          return
        }
        const doc = snap.docs[0]
        const id = doc.ref.parent.parent?.id
        if (!id) {
          setStep('not-found')
          return
        }
        const data = doc.data()
        setTeamId(id)
        setTeamName((data.name as string) || slug)
        setAccentColor((data.accentColor as string | null) ?? null)
        setShowBranding(data.showBranding === true)
        setStep('email')
      } catch {
        setStep('not-found')
      }
    }
    resolve()
  }, [slug])

  // Countdown timer for resend button
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  // ── Email step ──────────────────────────────────────────────────────────────

  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailSchema) })

  const onSendCode = async (values: EmailValues) => {
    if (!teamId) return
    setError(null)
    try {
      const fn = httpsCallable<{ email: string; teamId: string }, { codeId: string }>(
        functions,
        'sendMembershipVerificationCode'
      )
      const result = await fn({ email: values.email, teamId })
      setEmail(values.email)
      setCodeId(result.data.codeId)
      setCountdown(60)
      setStep('code')
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message || 'Failed to send code. Please try again.')
    }
  }

  // ── Code step ───────────────────────────────────────────────────────────────

  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) })

  const onVerifyCode = async (values: CodeValues) => {
    setError(null)
    try {
      const fn = httpsCallable<{ codeId: string; code: string }, { verified: boolean }>(
        functions,
        'verifyMembershipCode'
      )
      await fn({ codeId, code: values.code })
      setStep('form')
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message || 'Incorrect code. Please try again.')
    }
  }

  const onResendCode = async () => {
    if (countdown > 0 || !teamId) return
    setError(null)
    try {
      const fn = httpsCallable<{ email: string; teamId: string }, { codeId: string }>(
        functions,
        'sendMembershipVerificationCode'
      )
      const result = await fn({ email, teamId })
      setCodeId(result.data.codeId)
      setCountdown(60)
      codeForm.reset()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message || 'Failed to resend code.')
    }
  }

  // ── Details step ────────────────────────────────────────────────────────────

  const detailsForm = useForm<DetailsValues>({ resolver: zodResolver(detailsSchema) })

  const onSubmitDetails = async (values: DetailsValues) => {
    if (!teamId) return
    setError(null)
    try {
      const fn = httpsCallable<
        {
          codeId: string
          contactId: string
          teamId: string
          contactDetails: Omit<DetailsValues, 'note'>
          note?: string
        },
        { success: boolean; requestId: string }
      >(functions, 'requestContactUpdate')

      await fn({
        codeId,
        contactId,
        teamId,
        contactDetails: {
          firstname: values.firstname,
          lastname: values.lastname,
          phone: values.phone || undefined,
          birthdate: values.birthdate || undefined,
        },
        note: values.note || undefined,
      })
      setStep('success')
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message || 'Failed to submit update. Please try again.')
    }
  }

  // ── Shared field styling ────────────────────────────────────────────────────

  const inputClass =
    'w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  // ── Render: loading ─────────────────────────────────────────────────────────

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (step === 'not-found') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold">Team not found</p>
          <p className="text-muted-foreground text-sm">This link may be invalid or expired.</p>
        </div>
      </div>
    )
  }

  // ── Render: email step ──────────────────────────────────────────────────────

  if (step === 'email') {
    return (
      <BioLinkShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
      >
        <div>
          <h1 className="text-2xl font-bold">Update your details</h1>
          <p className="text-muted-foreground mt-1">
            Verify your email to update your personal information with <strong>{teamName}</strong>.
          </p>
        </div>

        <form onSubmit={emailForm.handleSubmit(onSendCode)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Email address</label>
            <input
              type="email"
              {...emailForm.register('email')}
              autoComplete="email"
              placeholder="your@email.com"
              className={inputClass}
            />
            {emailForm.formState.errors.email && (
              <p className="text-xs text-destructive">{emailForm.formState.errors.email.message}</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <BioLinkButton
            type="submit"
            disabled={emailForm.formState.isSubmitting}
            accentColor={accentColor}
          >
            {emailForm.formState.isSubmitting ? 'Sending…' : 'Send verification code'}
          </BioLinkButton>
        </form>
      </BioLinkShell>
    )
  }

  // ── Render: code step ───────────────────────────────────────────────────────

  if (step === 'code') {
    return (
      <BioLinkShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
      >
        <div>
          <button
            onClick={() => {
              setStep('email')
              setError(null)
            }}
            className="text-sm text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-muted-foreground mt-1">
            We sent a 6-digit code to <strong>{email}</strong>
          </p>
        </div>

        <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              {...codeForm.register('code', {
                onChange: (e) => {
                  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
                },
              })}
              placeholder="000000"
              className={`${inputClass} text-center tracking-widest text-lg font-mono`}
            />
            {codeForm.formState.errors.code && (
              <p className="text-xs text-destructive">{codeForm.formState.errors.code.message}</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <BioLinkButton
            type="submit"
            disabled={codeForm.formState.isSubmitting}
            accentColor={accentColor}
          >
            {codeForm.formState.isSubmitting ? 'Verifying…' : 'Verify code'}
          </BioLinkButton>
        </form>

        <div className="text-center">
          <button
            onClick={onResendCode}
            disabled={countdown > 0}
            className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {countdown > 0 ? `Resend in ${countdown}s` : "Didn't receive the code? Resend"}
          </button>
        </div>
      </BioLinkShell>
    )
  }

  // ── Render: details form ────────────────────────────────────────────────────

  if (step === 'form') {
    return (
      <BioLinkShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
      >
        <div>
          <h1 className="text-2xl font-bold">Your details</h1>
          <p className="text-muted-foreground mt-1">
            Submit your updated information. Your manager will review and apply the changes.
          </p>
        </div>

        {/* Info banner */}
        <div className="rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/20 dark:border-blue-800 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
          Your manager will compare the submitted data with what&apos;s currently on file before
          approving the update.
        </div>

        <form onSubmit={detailsForm.handleSubmit(onSubmitDetails)} className="space-y-4">
          {/* Email read-only */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">
                First name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                {...detailsForm.register('firstname')}
                autoComplete="given-name"
                className={inputClass}
              />
              {detailsForm.formState.errors.firstname && (
                <p className="text-xs text-destructive">
                  {detailsForm.formState.errors.firstname.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Last name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                {...detailsForm.register('lastname')}
                autoComplete="family-name"
                className={inputClass}
              />
              {detailsForm.formState.errors.lastname && (
                <p className="text-xs text-destructive">
                  {detailsForm.formState.errors.lastname.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Phone <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="tel"
              {...detailsForm.register('phone')}
              autoComplete="tel"
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Date of birth <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input type="date" {...detailsForm.register('birthdate')} className={inputClass} />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Note for your manager{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <textarea
              {...detailsForm.register('note')}
              rows={3}
              placeholder="e.g. I changed my address, updated phone number…"
              className={`${inputClass} resize-none`}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <BioLinkButton
            type="submit"
            disabled={detailsForm.formState.isSubmitting}
            accentColor={accentColor}
          >
            {detailsForm.formState.isSubmitting ? 'Submitting…' : 'Submit update request'}
          </BioLinkButton>
        </form>
      </BioLinkShell>
    )
  }

  // ── Render: success ─────────────────────────────────────────────────────────

  return (
    <BioLinkShell
      teamName={teamName}
      slug={slug}
      accentColor={accentColor}
      showBranding={showBranding}
    >
      <div className="space-y-6 text-center py-8">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Request submitted!</h1>
          <p className="text-muted-foreground mt-2">
            Your manager at <strong>{teamName}</strong> will review your details and apply the
            update. You&apos;ll receive an email once it&apos;s been processed.
          </p>
        </div>
        <a
          href={`/public/bio-link/${slug}`}
          className="inline-block text-sm text-primary hover:underline"
        >
          ← Back to bio link
        </a>
      </div>
    </BioLinkShell>
  )
}
