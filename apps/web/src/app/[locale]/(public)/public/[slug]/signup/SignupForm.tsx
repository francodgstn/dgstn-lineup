'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { BioLinkShell, BioLinkButton } from '../BioLinkShell'
import { usePublicTeam } from '../PublicTeamProvider'

// ─── steps ───────────────────────────────────────────────────────────────────

type Step = 'email' | 'code' | 'details' | 'success'

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
  notes: z.string().max(500).optional(),
  privacyConsent: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the privacy policy' }),
  }),
})

type EmailValues = z.infer<typeof emailSchema>
type CodeValues = z.infer<typeof codeSchema>
type DetailsValues = z.infer<typeof detailsSchema>

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  slug: string
}

export default function SignupForm({ slug }: Props) {
  // Team already resolved once by the parent PublicTeamProvider (the layout).
  const { teamId, team } = usePublicTeam()
  const teamName = team.name || ''
  const accentColor = team.bioLinkAccentColor ?? null
  const showBranding = team.showBranding === true
  // Documents the studio attached to signup consent (documents plugin config,
  // denormalized onto TeamPublicProfile by syncTeamPublicProfile). Empty/absent
  // falls back to the plain consent text below — no regression for teams without
  // the plugin installed.
  const signupDocs = team.signup_documents ?? []

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [codeId, setCodeId] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Arriving from a 'full'-mode shop purchase (pay/result CTA): the buyer already paid
  // and we have their email — prefill it and reframe the flow as "finishing" signup.
  const [fromCheckout, setFromCheckout] = useState(false)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailSchema) })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('from') === 'checkout') setFromCheckout(true)
    const prefill = params.get('email')
    if (prefill) {
      setEmail(prefill)
      emailForm.setValue('email', prefill)
    }
  }, [emailForm])
  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) })
  const detailsForm = useForm<DetailsValues>({ resolver: zodResolver(detailsSchema) })

  // ── Email step ─────────────────────────────────────────────────────────────

  const onSendCode = async (values: EmailValues) => {
    if (!teamId) return
    setError(null)
    try {
      const fn = httpsCallable<{ email: string; teamId: string }, { codeId: string }>(
        functions,
        'sendContactVerificationCode'
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

  // ── Code step ──────────────────────────────────────────────────────────────

  const onVerifyCode = async (values: CodeValues) => {
    setError(null)
    try {
      const fn = httpsCallable<{ codeId: string; code: string }, { verified: boolean }>(
        functions,
        'verifyContactCode'
      )
      await fn({ codeId, code: values.code })
      setStep('details')
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
        'sendContactVerificationCode'
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

  // ── Details step ───────────────────────────────────────────────────────────

  const onSubmitDetails = async (values: DetailsValues) => {
    setError(null)
    try {
      const fn = httpsCallable<
        {
          codeId: string
          contactDetails: Omit<DetailsValues, 'privacyConsent'> & { privacyConsent: boolean }
          acceptedDocuments?: Array<{ slug?: string; kind?: string; version?: string }>
        },
        { success: boolean }
      >(functions, 'completeSignup')

      await fn({
        codeId,
        contactDetails: {
          firstname: values.firstname,
          lastname: values.lastname,
          phone: values.phone || undefined,
          birthdate: values.birthdate || undefined,
          notes: values.notes || undefined,
          privacyConsent: true,
        },
        acceptedDocuments:
          signupDocs.length > 0
            ? signupDocs.map((d) => ({ slug: d.slug, kind: d.kind, version: '' }))
            : undefined,
      })
      setStep('success')
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message || 'Failed to complete signup. Please try again.')
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (step === 'email') {
    return (
      <BioLinkShell
        teamName={teamName}
        slug={slug}
        accentColor={accentColor}
        showBranding={showBranding}
      >
        <div>
          <h1 className="text-2xl font-bold">
            {fromCheckout ? 'Finish your registration' : `Register at ${teamName}`}
          </h1>
          <p className="text-muted-foreground mt-1">
            {fromCheckout
              ? `Payment received. Confirm your email to finish setting up your account at ${teamName}.`
              : "Enter your email to get started. We'll send a quick verification code."}
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
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-center tracking-widest text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary"
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

  if (step === 'details') {
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
            Just a few things and you&apos;re all set at <strong>{teamName}</strong>.
          </p>
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
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Date of birth <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="date"
              {...detailsForm.register('birthdate')}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Anything else? <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <textarea
              {...detailsForm.register('notes')}
              rows={3}
              placeholder="Health notes, questions for the coach…"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                {...detailsForm.register('privacyConsent')}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-primary"
              />
              <span className="text-sm text-muted-foreground">
                I agree to the processing of my personal data by {teamName}
                {signupDocs.length > 0 && (
                  <>
                    {' '}and accept the{' '}
                    {signupDocs.map((d, i) => (
                      <span key={d.slug}>
                        {i > 0 && (i === signupDocs.length - 1 ? ' and ' : ', ')}
                        <a
                          href={`/public/${slug}/documents/${d.slug}`}
                          target="_blank"
                          rel="noopener"
                          className="underline hover:text-foreground"
                        >
                          {d.title}
                        </a>
                      </span>
                    ))}
                  </>
                )}
                .
              </span>
            </label>
            {detailsForm.formState.errors.privacyConsent && (
              <p className="text-xs text-destructive">
                {detailsForm.formState.errors.privacyConsent.message}
              </p>
            )}
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
            {detailsForm.formState.isSubmitting ? 'Saving…' : 'Complete registration'}
          </BioLinkButton>
        </form>
      </BioLinkShell>
    )
  }

  // ── Success ─────────────────────────────────────────────────────────────────

  return (
    <BioLinkShell
      teamName={teamName}
      slug={slug}
      accentColor={accentColor}
      showBranding={showBranding}
    >
      <div className="py-8 text-center space-y-5">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <svg
            className="w-8 h-8 text-green-600 dark:text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold">You&apos;re registered!</h1>
          <p className="text-muted-foreground mt-2">
            Welcome to <strong>{teamName}</strong>. Your details have been saved. The team will be
            in touch soon.
          </p>
        </div>
        <a
          href={`/public/${slug}`}
          className="inline-block text-sm text-primary hover:underline"
        >
          ← Back to bio link
        </a>
      </div>
    </BioLinkShell>
  )
}
