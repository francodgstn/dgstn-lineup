'use client'

// Public self-checkout ("shop"): lists what a studio sells (Phase 1: public
// subscription types) and lets a member pay via Stripe Connect. Branded with the
// team's bio-link palette. No login required — just an email; the webhook
// links/creates the contact. Structured to add a products section later.

import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable, type FunctionsError } from 'firebase/functions'
import { useTranslations, useLocale } from 'next-intl'
import { ShoppingBag, Loader2, X } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { resolveBackground, getTextColor } from '@/lib/bioLink'
import { formatCurrency } from '@/lib/format'
import { usePublicTeam } from '../PublicTeamProvider'

interface PlanPrice {
  id?: string
  amount: number
  recurrence: string
  label?: string
  included_months?: number
}
interface PlanEntry {
  id: string
  name: string
  description?: string
  prices?: PlanPrice[]
}

type Selected = { typeId: string; typeName: string; price: PlanPrice }

function prefillEmail(): string {
  try {
    const raw = localStorage.getItem('linyup:space:session')
    if (raw) return (JSON.parse(raw)?.contact?.email as string | undefined) ?? ''
  } catch {
    /* ignore */
  }
  return ''
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ShopHome({ focusTypeId }: { focusTypeId: string | null }) {
  const t = useTranslations('Shop')
  const locale = useLocale()
  const { slug, teamId, team } = usePublicTeam()

  const [plans, setPlans] = useState<PlanEntry[]>([])
  const [currency, setCurrency] = useState('CHF')
  const [loading, setLoading] = useState(true)
  const [systemDark, setSystemDark] = useState(false)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    getDoc(doc(db, 'teams', teamId, 'public_profile', teamId))
      .then((snap) => {
        const list = (snap.data()?.aggregator_subscription_types ?? []) as PlanEntry[]
        setPlans(Array.isArray(list) ? list : [])
        setCurrency((snap.data()?.default_currency as string | undefined) ?? 'CHF')
      })
      .catch(() => setPlans([]))
      .finally(() => setLoading(false))
  }, [teamId])

  useEffect(() => {
    if (team?.bioLinkTheme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [team?.bioLinkTheme])

  // Pre-focus a subscription card from ?type=.
  useEffect(() => {
    if (!focusTypeId || loading) return
    const el = cardRefs.current[focusTypeId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusTypeId, loading])

  const isDark = team?.bioLinkTheme === 'dark' || (team?.bioLinkTheme === 'auto' && systemDark)
  const bg = team?.bioLinkBackground
  const bgStyle = resolveBackground(bg, isDark)
  const onDark = getTextColor(bg, isDark) === 'light'
  const accent = team?.bioLinkAccentColor ?? '#6366f1'
  const textMain = onDark ? '#f9fafb' : '#111827'
  const textMuted = onDark ? 'rgba(249,250,251,0.65)' : '#6b7280'
  const cardBg = onDark ? 'rgba(255,255,255,0.08)' : '#ffffff'
  const cardBorder = onDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)'

  const recurrenceSuffix = useMemo(
    () =>
      (r: string): string => {
        const key = `recurrence.${r}`
        const val = t(key as Parameters<typeof t>[0])
        return val === key ? '' : val
      },
    [t]
  )

  function openCheckout(typeId: string, typeName: string, price: PlanPrice) {
    setSelected({ typeId, typeName, price })
    setEmail(prefillEmail())
    setError(null)
  }

  async function submit() {
    if (!selected?.price.id || !EMAIL_RE.test(email.trim())) {
      setError(t('emailInvalid'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const fn = httpsCallable<
        {
          teamId: string
          subscriptionTypeId: string
          priceId: string
          memberEmail: string
          slug: string
          locale: string
        },
        { url: string }
      >(functions, 'createMembershipCheckout')
      const res = await fn({
        teamId,
        subscriptionTypeId: selected.typeId,
        priceId: selected.price.id,
        memberEmail: email.trim(),
        slug,
        locale,
      })
      if (res.data?.url) window.location.href = res.data.url
      else throw new Error('no-url')
    } catch (err) {
      const code = (err as FunctionsError)?.code
      setError(code === 'functions/failed-precondition' ? t('notAvailable') : t('checkoutError'))
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen w-full" style={{ background: bgStyle, color: textMain }}>
      <div className="max-w-[640px] mx-auto px-5 pb-16">
        <div className="pt-10 flex items-center gap-3">
          {team?.profileImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={team.profileImage}
              alt={team?.name ?? ''}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <ShoppingBag className="h-9 w-9" style={{ color: accent }} />
          )}
          <div>
            <h1 className="text-xl font-bold leading-tight">{team?.name ?? t('title')}</h1>
            <p className="text-sm" style={{ color: textMuted }}>
              {t('subtitle')}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: textMuted }} />
          </div>
        ) : plans.length === 0 ? (
          <p className="mt-10 text-center text-sm" style={{ color: textMuted }}>
            {t('noItems')}
          </p>
        ) : (
          <section className="mt-8 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: textMuted }}>
              {t('subscriptionsSection')}
            </h2>
            {plans.map((plan) => (
              <div
                key={plan.id}
                ref={(el) => {
                  cardRefs.current[plan.id] = el
                }}
                className="rounded-2xl border p-5 transition-shadow"
                style={{
                  background: cardBg,
                  borderColor: focusTypeId === plan.id ? accent : cardBorder,
                  boxShadow: focusTypeId === plan.id ? `0 0 0 1px ${accent}` : undefined,
                }}
              >
                <p className="text-base font-semibold">{plan.name}</p>
                {plan.description && (
                  <p className="mt-1 text-sm" style={{ color: textMuted }}>
                    {plan.description}
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {(plan.prices ?? []).map((price, i) => (
                    <div key={price.id ?? i} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm font-medium">
                          {formatCurrency(price.amount, currency)}
                          <span style={{ color: textMuted }}> {recurrenceSuffix(price.recurrence)}</span>
                        </span>
                        {(price.label || price.included_months) && (
                          <span className="ml-2 text-xs" style={{ color: textMuted }}>
                            {price.label}
                            {price.included_months
                              ? ` · ${t('includedMonths', { count: price.included_months })}`
                              : ''}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={!price.id}
                        onClick={() => openCheckout(plan.id, plan.name, price)}
                        className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40"
                        style={{ background: accent, color: '#ffffff' }}
                      >
                        {t('buy')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      {/* Email → checkout modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !submitting && setSelected(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: cardBg, color: textMain }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{selected.typeName}</p>
                <p className="text-xs" style={{ color: textMuted }}>
                  {formatCurrency(selected.price.amount, currency)}{' '}
                  {recurrenceSuffix(selected.price.recurrence)}
                </p>
              </div>
              <button type="button" onClick={() => !submitting && setSelected(null)} aria-label={t('cancel')}>
                <X className="h-4 w-4" style={{ color: textMuted }} />
              </button>
            </div>
            <label className="mt-4 block text-xs font-medium">{t('emailLabel')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: cardBorder, background: onDark ? 'rgba(0,0,0,0.2)' : '#fff', color: textMain }}
            />
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-4 flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: accent, color: '#ffffff' }}
            >
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('continueToPayment')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
