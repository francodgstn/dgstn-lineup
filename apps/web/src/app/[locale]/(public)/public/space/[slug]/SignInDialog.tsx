'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useSpaceAuth } from './SpaceAuthProvider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
}

export default function SignInDialog({ open, onOpenChange, slug }: Props) {
  const t = useTranslations('Space')
  const {
    step, error, matchedContacts, requiresSignup, clearError,
    sendCode, verifyCode, selectContact,
  } = useSpaceAuth()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Close dialog when auth succeeds
  useEffect(() => {
    if (step === 'authenticated') {
      onOpenChange(false)
    }
  }, [step, onOpenChange])

  // Countdown for resend
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await sendCode(email)
    setSubmitting(false)
    setCountdown(60)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    await verifyCode(code)
    setSubmitting(false)
  }

  async function handleSelectContact(contactId: string) {
    setSubmitting(true)
    await selectContact(contactId)
    setSubmitting(false)
  }

  async function handleResend() {
    if (countdown > 0) return
    setCode('')
    clearError()
    setSubmitting(true)
    await sendCode(email)
    setSubmitting(false)
    setCountdown(60)
  }

  function handleClose() {
    clearError()
    onOpenChange(false)
  }

  const currentStep = step === 'idle' ? 'email' : step

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('signInDialogTitle')}</DialogTitle>
        </DialogHeader>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Requires signup */}
        {requiresSignup && (
          <div className="space-y-4 py-2">
            <p className="font-semibold">{t('signInDialogRequiresSignup')}</p>
            <p className="text-sm text-muted-foreground">{t('signInDialogRequiresSignupDesc')}</p>
            <Link
              href={`/public/bio-link/${slug}/membership-signup` as Route}
              className="inline-block text-sm text-primary hover:underline"
            >
              {t('signInDialogSignupLink')} →
            </Link>
          </div>
        )}

        {/* Email step */}
        {!requiresSignup && currentStep === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t('signInDialogEmailLabel')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('signInDialogEmailPlaceholder')}
                autoComplete="email"
                required
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? t('signInDialogSending') : t('signInDialogSendCode')}
            </button>
          </form>
        )}

        {/* Code step */}
        {!requiresSignup && currentStep === 'code' && (
          <div className="space-y-4">
            <button
              onClick={() => { clearError(); setCode('') }}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              ← {t('signInDialogBack')}
            </button>
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t('signInDialogCodeLabel')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-center tracking-widest text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || code.length < 6}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {submitting ? t('signInDialogVerifying') : t('signInDialogVerify')}
              </button>
            </form>
            <div className="text-center">
              <button
                onClick={handleResend}
                disabled={countdown > 0 || submitting}
                className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {countdown > 0
                  ? t('signInDialogResendIn', { seconds: countdown })
                  : t('signInDialogResend')}
              </button>
            </div>
          </div>
        )}

        {/* Contact selection */}
        {!requiresSignup && currentStep === 'selectContact' && (
          <div className="space-y-4">
            <p className="font-semibold">{t('signInDialogSelectContact')}</p>
            <p className="text-sm text-muted-foreground">{t('signInDialogSelectContactDesc')}</p>
            <div className="space-y-2">
              {matchedContacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectContact(c.id)}
                  disabled={submitting}
                  className="w-full text-left rounded-lg border bg-card px-4 py-3 text-sm font-medium hover:border-primary/60 hover:bg-primary/5 transition-colors disabled:opacity-50"
                >
                  {c.firstname} {c.lastname}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Already authenticated (shouldn't show, but safety) */}
        {step === 'authenticated' && (
          <p className="text-sm text-muted-foreground">{t('signInDialogConfirm')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
