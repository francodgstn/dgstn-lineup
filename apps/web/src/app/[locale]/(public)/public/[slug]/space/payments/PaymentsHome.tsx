'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { formatCurrency } from '@/lib/format'
import { CreditCard, Receipt, ExternalLink, LogIn, Loader2 } from 'lucide-react'
import { useSpaceAuth } from '../SpaceAuthProvider'
import { useSpaceTheme } from '../useSpaceTheme'
import { usePublicTeam } from '../../PublicTeamProvider'
import { useSpacePayments } from '../useSpacePayments'

function formatDate(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString()
}

export default function PaymentsHome() {
  const t = useTranslations('Space')
  const locale = useLocale()
  const { slug, isAuthenticated, openSignIn } = useSpaceAuth()
  const { accent, textMain, textMuted, cardBg, cardBorder } = useSpaceTheme()
  const { team } = usePublicTeam()
  const currency = team?.default_currency ?? 'CHF'
  const { data, isLoading } = useSpacePayments()
  const [portalLoading, setPortalLoading] = useState(false)

  const cardStyle = { background: cardBg, border: `1px solid ${cardBorder}` }

  if (!isAuthenticated) {
    return (
      <div className="mt-10 rounded-2xl p-8 text-center" style={cardStyle}>
        <LogIn className="mx-auto h-7 w-7" style={{ color: accent }} />
        <p className="mt-3 text-sm" style={{ color: textMuted }}>{t('accountSignInPrompt')}</p>
        <button
          onClick={() => openSignIn()}
          className="mt-4 text-sm font-medium px-4 py-2 rounded-full"
          style={{ background: accent, color: '#fff' }}
        >
          {t('signIn')}
        </button>
      </div>
    )
  }

  async function openBillingPortal() {
    setPortalLoading(true)
    try {
      const fn = httpsCallable<{ slug: string; locale: string; origin: string }, { url: string }>(
        functions,
        'createContactBillingPortalSession'
      )
      const res = await fn({ slug, locale, origin: window.location.origin })
      if (res.data?.url) window.location.href = res.data.url
      else setPortalLoading(false)
    } catch {
      // Portal not configured / no customer — leave the button and stop the spinner.
      setPortalLoading(false)
    }
  }

  const payments = data?.payments ?? []

  return (
    <div className="mt-6 space-y-4">
      {/* Manage billing in Stripe — only for contacts with a Stripe customer */}
      {data?.billingAvailable && (
        <button
          type="button"
          onClick={openBillingPortal}
          disabled={portalLoading}
          className="flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-60"
          style={{ background: `${accent}14`, color: textMain }}
        >
          <CreditCard className="h-4 w-4" style={{ color: accent }} />
          <span className="flex-1 text-left">{t('manageBilling')}</span>
          {portalLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: textMuted }} />
          ) : (
            <ExternalLink className="h-4 w-4" style={{ color: textMuted }} />
          )}
        </button>
      )}

      {/* Payment history */}
      <section className="rounded-2xl p-4" style={cardStyle}>
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="h-4 w-4" style={{ color: accent }} />
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: textMuted }}>
            {t('paymentsTitle')}
          </h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <div
              className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: accent, borderTopColor: 'transparent' }}
            />
          </div>
        ) : payments.length === 0 ? (
          <p className="text-sm py-4" style={{ color: textMuted }}>{t('paymentsEmpty')}</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: cardBorder }}>
            {payments.map((p) => {
              const refunded = p.refundedAmount > 0
              const failed = p.status !== 'succeeded'
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: textMain }}>{p.label}</p>
                    <p className="text-xs" style={{ color: textMuted }}>
                      {formatDate(p.createdAt)}
                      {p.promoCode ? ` · ${t('paymentPromoCode', { code: p.promoCode })}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className="text-sm font-medium"
                      style={{ color: textMain, textDecoration: failed ? 'line-through' : undefined }}
                    >
                      {formatCurrency(p.amount / 100, currency)}
                    </p>
                    {failed ? (
                      <p className="text-[11px]" style={{ color: '#dc2626' }}>{t('paymentFailed')}</p>
                    ) : refunded ? (
                      <p className="text-[11px]" style={{ color: textMuted }}>
                        {t('paymentRefunded', { amount: formatCurrency(p.refundedAmount / 100, currency) })}
                      </p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
