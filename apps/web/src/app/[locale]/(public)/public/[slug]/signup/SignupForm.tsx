'use client'

import { useState, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { httpsCallable } from 'firebase/functions'
import { doc, getDoc } from 'firebase/firestore'
import { db, functions } from '@/lib/firebase'
import { useTranslations } from 'next-intl'
import { CONTACTS_COLLECTION, type PublicFrom } from '@linyup/shared'
import { Link } from '@/i18n/navigation'
import { publicHref, returnHref } from '@/lib/publicRoutes'
import { BioLinkShell, BioLinkButton } from '../BioLinkShell'
import { usePublicTeam } from '../PublicTeamProvider'
import { usePublicContactAuth } from '../PublicContactAuthProvider'

// ─── steps ───────────────────────────────────────────────────────────────────

type Step = 'email' | 'code' | 'details' | 'success'

// ─── schemas ─────────────────────────────────────────────────────────────────

function createEmailSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    email: z.string().email(t('errorInvalidEmailAddress')),
  })
}

function createCodeSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    code: z.string().regex(/^\d{6}$/, t('errorEnterCode')),
  })
}

function createDetailsSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    firstname: z.string().min(1, t('errorRequired')).max(60),
    lastname: z.string().min(1, t('errorRequired')).max(60),
    phone: z.string().max(30).optional(),
    birthdate: z.string().optional(),
    notes: z.string().max(500).optional(),
    privacyConsent: z.literal(true, {
      errorMap: () => ({ message: t('errorPrivacyPolicyRequired') }),
    }),
  })
}

type EmailValues = z.infer<ReturnType<typeof createEmailSchema>>
type CodeValues = z.infer<ReturnType<typeof createCodeSchema>>
type DetailsValues = z.infer<ReturnType<typeof createDetailsSchema>>

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  slug: string
  /** `?from=` — which surface to return to. See `returnHref`. */
  from?: PublicFrom
}

export default function SignupForm({ slug, from }: Props) {
  // Team already resolved once by the parent PublicTeamProvider (the layout).
  const { teamId, team } = usePublicTeam()
  // A live contact session skips the email+OTP steps entirely: the session was
  // itself minted by the same OTP flow, so re-verifying the inbox is pure friction.
  const { isAuthenticated, contact: sessionContact } = usePublicContactAuth()
  const t = useTranslations('PublicSignup')
  const tSurfaces = useTranslations('PublicSurfaceLinks')
  // Where 'back' goes: the surface named by `?from=`, else whatever default the
  // studio chose (bio-link, website, shop, …). Labelled to match, and resolved
  // here rather than by bouncing through the team root's client redirect.
  const backTo = returnHref(team, slug, from)
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
  // Retained after a successful verify so completeSignup can re-present the code
  // (defence in depth: ties completion to knowledge of the code, not just codeId).
  const [verifiedCode, setVerifiedCode] = useState('')
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

  const emailSchema = useMemo(() => createEmailSchema(t), [t])
  const codeSchema = useMemo(() => createCodeSchema(t), [t])
  const detailsSchema = useMemo(() => createDetailsSchema(t), [t])

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

  // Signed-in contact → jump straight to the details step with names prefilled
  // (completeSignup runs against the session, no code needed). If their signup is
  // ALREADY complete (signup_completed_at on their own contact doc — rules allow
  // self-read), skip the form entirely and land on the success view: don't re-ask
  // details + consent they already gave (e.g. arriving via a stale post-checkout
  // link). Only from the email/code steps — never yank the user out of an
  // in-progress details form.
  useEffect(() => {
    if (!isAuthenticated || !sessionContact) return
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, CONTACTS_COLLECTION, sessionContact.id))
        if (!cancelled && snap.data()?.signup_completed_at) {
          setStep((s) => (s === 'email' || s === 'code' ? 'success' : s))
          return
        }
      } catch {
        /* self-read failed — fall through to the normal details step */
      }
      if (cancelled) return
      setStep((s) => (s === 'email' || s === 'code' ? 'details' : s))
      if (!detailsForm.getValues('firstname')) detailsForm.setValue('firstname', sessionContact.firstname ?? '')
      if (!detailsForm.getValues('lastname')) detailsForm.setValue('lastname', sessionContact.lastname ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, sessionContact, detailsForm])

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
      setError(e.message || t('errorSendCodeFailed'))
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
      setVerifiedCode(values.code)
      setStep('details')
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message || t('errorIncorrectCode'))
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
      setError(e.message || t('errorResendCodeFailed'))
    }
  }

  // ── Details step ───────────────────────────────────────────────────────────

  const onSubmitDetails = async (values: DetailsValues) => {
    setError(null)
    try {
      const fn = httpsCallable<
        {
          codeId?: string
          code?: string
          teamId?: string
          contactDetails: Omit<DetailsValues, 'privacyConsent'> & { privacyConsent: boolean }
          acceptedDocuments?: Array<{ slug?: string; kind?: string; version?: string }>
        },
        { success: boolean }
      >(functions, 'completeSignup')

      await fn({
        // Session path (signed-in contact, no OTP round-trip) vs. anonymous code path.
        ...(isAuthenticated && !codeId ? { teamId: teamId ?? undefined } : { codeId, code: verifiedCode }),
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
      setError(e.message || t('errorCompleteSignupFailed'))
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
            {fromCheckout ? t('finishRegistrationTitle') : t('registerAtTeamTitle', { teamName })}
          </h1>
          <p className="text-muted-foreground mt-1">
            {fromCheckout
              ? t('paymentReceivedSubtitle', { teamName })
              : t('enterEmailSubtitle')}
          </p>
        </div>

        <form onSubmit={emailForm.handleSubmit(onSendCode)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('labelEmailAddress')}</label>
            <input
              type="email"
              {...emailForm.register('email')}
              autoComplete="email"
              placeholder={t('placeholderEmailExample')}
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
            {emailForm.formState.isSubmitting ? t('sendingEllipsis') : t('sendVerificationCode')}
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
            {t('backArrow')}
          </button>
          <h1 className="text-2xl font-bold">{t('checkYourEmailTitle')}</h1>
          <p className="text-muted-foreground mt-1">
            {t.rich('codeSentTo', { email, strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </div>

        <form onSubmit={codeForm.handleSubmit(onVerifyCode)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('labelVerificationCode')}</label>
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
              placeholder={t('placeholderCode')}
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
            {codeForm.formState.isSubmitting ? t('verifyingEllipsis') : t('verifyCode')}
          </BioLinkButton>
        </form>

        <div className="text-center">
          <button
            onClick={onResendCode}
            disabled={countdown > 0}
            className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {countdown > 0 ? t('resendIn', { countdown }) : t('resendPrompt')}
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
          <h1 className="text-2xl font-bold">{t('yourDetailsTitle')}</h1>
          <p className="text-muted-foreground mt-1">
            {t.rich('detailsSubtitle', { teamName, strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </div>

        <form onSubmit={detailsForm.handleSubmit(onSubmitDetails)} className="space-y-4">
          {/* Email read-only */}
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('labelEmail')}</label>
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
                {t('labelFirstName')} <span className="text-destructive">*</span>
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
                {t('labelLastName')} <span className="text-destructive">*</span>
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
              {t('labelPhone')} <span className="text-muted-foreground font-normal">{t('optionalSuffix')}</span>
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
              {t('labelDateOfBirth')} <span className="text-muted-foreground font-normal">{t('optionalSuffix')}</span>
            </label>
            <input
              type="date"
              {...detailsForm.register('birthdate')}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('labelAnythingElse')} <span className="text-muted-foreground font-normal">{t('optionalSuffix')}</span>
            </label>
            <textarea
              {...detailsForm.register('notes')}
              rows={3}
              placeholder={t('placeholderNotes')}
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
                {t('consentBase', { teamName })}
                {signupDocs.length > 0 && (
                  <>
                    {' '}
                    {t('andAcceptThe')}
                    {' '}
                    {signupDocs.map((d, i) => (
                      <span key={d.slug}>
                        {i > 0 && (i === signupDocs.length - 1 ? t('listAndSeparator') : ', ')}
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
            {detailsForm.formState.isSubmitting ? t('savingEllipsis') : t('completeRegistration')}
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
          <h1 className="text-2xl font-bold">{t('registeredTitle')}</h1>
          <p className="text-muted-foreground mt-2">
            {t.rich('successBody', { teamName, strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </div>
        <div className="space-y-2">
          {/* Their personal portal — where membership, bookings and courses live. */}
          <Link
            href={publicHref(slug, 'space')}
            className="block text-sm font-medium text-primary hover:underline"
          >
            {t('openSpace')}
          </Link>
          <Link
            href={backTo.href}
            className="block text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('toSurface', { name: tSurfaces(backTo.surface) })}
          </Link>
        </div>
      </div>
    </BioLinkShell>
  )
}
