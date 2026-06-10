'use client'

import { Suspense, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { db, functions } from '@/lib/firebase'
import { httpsCallable } from 'firebase/functions'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { TEAMS_COLLECTION, PLAN_ORDER, TRIAL_EXTENSION_DAYS } from '@linyup/shared'
import type { SaasSubscription, SaasPlan, Team } from '@linyup/shared'
import {
  CreditCard,
  FileText,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Check,
} from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  amount: number
  currency: string
  status: string
  created: string
  hostedUrl?: string
  pdfUrl?: string
}

// ─── plan feature copy ────────────────────────────────────────────────────────

const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  free: [
    'Up to 10 active contacts',
    'Single user',
    'Public portal & booking forms',
    'Sessions, subscriptions & QR check-in',
  ],
  coach: [
    'Everything in Free — 30 included contacts',
    'Team members & coaching slots',
    'No Linyup branding on your portal',
    'Plugin add-ons available',
  ],
  club: [
    'Everything in Coach',
    'Student mobile app',
    'Automations & outreach templates',
    'Multiple managers & AI insights',
  ],
  organization: [
    'Everything in Club',
    'Multi-club management',
    'Cross-club events & messaging',
    'API access & advanced permissions',
  ],
}

// ─── data hooks ───────────────────────────────────────────────────────────────

function useSubscription(teamId: string | null) {
  return useQuery<SaasSubscription | null>({
    queryKey: ['saas-subscription', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const snap = await getDoc(doc(db, 'saas_subscriptions', teamId))
      return snap.exists() ? (snap.data() as SaasSubscription) : null
    },
  })
}

function useIsOwner(teamId: string | null, userId: string | null) {
  return useQuery<boolean>({
    queryKey: ['team-role', teamId, userId],
    enabled: !!teamId && !!userId,
    queryFn: async () => {
      if (!teamId || !userId) return false
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId, 'team_members', userId))
      return snap.exists() && snap.data()?.role === 'owner'
    },
  })
}

function useInvoices(teamId: string | null, enabled: boolean) {
  return useQuery<Invoice[]>({
    queryKey: ['saas-invoices', teamId],
    enabled: !!teamId && enabled,
    queryFn: async () => {
      const getSaasInvoices = httpsCallable<{ teamId: string }, { invoices: Invoice[] }>(functions, 'getSaasInvoices')
      const result = await getSaasInvoices({ teamId: teamId! })
      return result.data.invoices
    },
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function toTs(ts: unknown): number | null {
  if (!ts) return null
  const obj = ts as { seconds?: number }
  return obj.seconds ? obj.seconds * 1000 : null
}

function formatDate(ts: unknown) {
  const ms = toTs(ts)
  return ms ? new Date(ms).toLocaleDateString() : null
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100)
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default'
  if (status === 'trial') return 'secondary'
  if (status === 'past_due' || status === 'cancelled') return 'destructive'
  return 'outline'
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'active') return <CheckCircle2 className="h-4 w-4 text-green-600" />
  if (status === 'trial') return <Clock className="h-4 w-4 text-amber-500" />
  return <AlertTriangle className="h-4 w-4 text-destructive" />
}

function planRank(plan: SaasPlan): number {
  return PLAN_ORDER.indexOf(plan)
}

// ─── checkout result banner ───────────────────────────────────────────────────

function CheckoutBanner() {
  const t = useTranslations('Billing')
  const searchParams = useSearchParams()
  const result = searchParams.get('checkout')

  if (result === 'success') {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {t('checkoutSuccess')}
      </div>
    )
  }
  if (result === 'cancelled') {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-muted border text-sm text-muted-foreground">
        {t('checkoutCancelled')}
      </div>
    )
  }
  return null
}

// ─── subscription card ────────────────────────────────────────────────────────

function SubscriptionCard({ sub, team, teamId }: { sub: SaasSubscription | null; team: Team | null; teamId: string }) {
  const t = useTranslations('Billing')
  const queryClient = useQueryClient()

  const [cancelling, setCancelling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  const plans = ['free', 'coach', 'club', 'organization'] as const
  // Free teams have no subscription doc (or a cancelled one) — current-plan
  // detection for Free must come from the team doc, not the sub.
  const onFreePlan = team?.plan === 'free' && (!sub || sub.status === 'cancelled')
  const currentPlanRank = sub && sub.status !== 'cancelled' && sub.plan ? planRank(sub.plan) : onFreePlan ? planRank('free') : -1

  async function handleUpgrade(plan: string) {
    setCheckoutLoading(plan)
    try {
      const createCheckout = httpsCallable<{ teamId: string; plan: string }, { url: string }>(functions, 'createCheckoutSession')
      const result = await createCheckout({ teamId, plan })
      const url = result.data.url
      if (!url.startsWith('https://checkout.stripe.com/') && !url.startsWith('https://billing.stripe.com/')) {
        throw new Error('Unexpected checkout URL')
      }
      window.location.href = url
    } catch (err) {
      console.error('Checkout failed:', err)
    } finally {
      setCheckoutLoading(null)
    }
  }

  async function handleCancel() {
    setCancelling(true)
    try {
      const cancelFn = httpsCallable<{ teamId: string }>(functions, 'cancelSaasSubscription')
      await cancelFn({ teamId })
      setConfirmCancel(false)
      await queryClient.invalidateQueries({ queryKey: ['saas-subscription', teamId] })
    } catch (err) {
      console.error('Cancel failed:', err)
    } finally {
      setCancelling(false)
    }
  }

  async function handleReactivate() {
    setReactivating(true)
    try {
      const reactivateFn = httpsCallable<{ teamId: string }>(functions, 'reactivateSaasSubscription')
      await reactivateFn({ teamId })
      await queryClient.invalidateQueries({ queryKey: ['saas-subscription', teamId] })
    } catch (err) {
      console.error('Reactivate failed:', err)
    } finally {
      setReactivating(false)
    }
  }

  async function handleUpdatePayment() {
    setPaymentLoading(true)
    try {
      const fn = httpsCallable<{ teamId: string; returnUrl: string }, { url: string }>(functions, 'getBillingPortalUrl')
      const result = await fn({ teamId, returnUrl: window.location.href })
      const url = result.data.url
      if (!url.startsWith('https://billing.stripe.com/')) throw new Error('Unexpected URL')
      window.location.href = url
    } catch (err) {
      console.error('Payment update failed:', err)
    } finally {
      setPaymentLoading(false)
    }
  }

  const periodEndMs = toTs(sub?.current_period_end)
  const periodStartMs = toTs(sub?.current_period_start)
  const trialEndMs = toTs(sub?.trial_ends_at)

  const periodEndDate = periodEndMs ? new Date(periodEndMs) : null
  const periodStartDate = periodStartMs ? new Date(periodStartMs) : null
  const trialEndDate = trialEndMs ? new Date(trialEndMs) : null

  return (
    <>
      {/* Current plan status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            {t('currentPlan')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sub ? (
            <div className="space-y-4">
              {/* Plan name + status */}
              <div className="flex items-center gap-3 flex-wrap">
                <StatusIcon status={sub.status} />
                <span className="font-semibold capitalize">
                  {sub.plan === 'organization' ? 'Organization' : sub.plan} plan
                </span>
                <Badge variant={statusVariant(sub.status)} className="capitalize">
                  {sub.status.replace('_', ' ')}
                </Badge>
                {sub.cancel_at_period_end && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    {t('cancelAtPeriodEnd')}
                  </Badge>
                )}
              </div>

              {/* Cancelled sub → the team now runs on the Free plan */}
              {onFreePlan && (
                <p className="text-sm text-muted-foreground">{t('onFreePlan')}</p>
              )}

              {/* Billing period */}
              {sub.status !== 'trial' && periodStartDate && periodEndDate && (
                <p className="text-sm text-muted-foreground">
                  {t('periodLabel')}: {periodStartDate.toLocaleDateString()} – {periodEndDate.toLocaleDateString()}
                </p>
              )}

              {/* Trial end */}
              {sub.status === 'trial' && trialEndDate && (
                <p className="text-sm text-muted-foreground">
                  {t('trialEnds', { date: trialEndDate.toLocaleDateString() })}
                </p>
              )}

              {/* Renewal / access-until (when period start not available) */}
              {sub.status !== 'trial' && !periodStartDate && periodEndDate && (
                <p className="text-sm text-muted-foreground">
                  {sub.cancel_at_period_end
                    ? t('accessUntil', { date: periodEndDate.toLocaleDateString() })
                    : t('nextBilling', { date: periodEndDate.toLocaleDateString() })}
                </p>
              )}

              {/* Past due warning */}
              {sub.status === 'past_due' && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5 flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  {t('pastDueWarning')}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {sub.cancel_at_period_end && sub.status === 'active' && (
                  <Button size="sm" variant="outline" onClick={handleReactivate} disabled={reactivating}>
                    {reactivating ? t('reactivating') : t('reactivate')}
                  </Button>
                )}
                {(sub.status === 'active' || sub.status === 'past_due') && sub.gateway_type === 'stripe' && (
                  <Button size="sm" variant="ghost" onClick={handleUpdatePayment} disabled={paymentLoading}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    {paymentLoading ? t('updatingPayment') : t('updatePayment')}
                  </Button>
                )}
                {sub.status === 'active' && !sub.cancel_at_period_end && (
                  <button
                    className="text-xs text-muted-foreground hover:text-destructive underline ml-auto"
                    onClick={() => setConfirmCancel(true)}
                  >
                    {t('cancelSubscription')}
                  </button>
                )}
              </div>
            </div>
          ) : onFreePlan ? (
            <div className="flex items-center gap-3 flex-wrap">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="font-semibold">{t('freePlanName')}</span>
              <span className="text-sm text-muted-foreground">{t('onFreePlan')}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noSubscription')}</p>
          )}
        </CardContent>
      </Card>

      {/* Plan selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('choosePlan')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const isCurrent = plan === 'free'
                ? onFreePlan
                : sub?.plan === plan && sub.status !== 'cancelled'
              const isDowngrade = !isCurrent && currentPlanRank > planRank(plan)
              // Free is never "selected" via checkout — you land on it by
              // cancelling (or letting the trial lapse).
              const selectable = plan !== 'free' && !isCurrent && !isDowngrade
              return (
                <div
                  key={plan}
                  className={`rounded-lg border p-4 space-y-3 ${isCurrent ? 'border-primary bg-primary/5' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold capitalize">
                      {plan === 'organization' ? 'Organization' : plan}
                    </p>
                    {isCurrent && (
                      <Badge variant="default" className="text-xs shrink-0">
                        {t('currentPlanBadge')}
                      </Badge>
                    )}
                  </div>

                  <ul className="space-y-1.5">
                    {PLAN_HIGHLIGHTS[plan].map((feature) => (
                      <li key={feature} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {selectable && (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!!checkoutLoading}
                      onClick={() => handleUpgrade(plan)}
                    >
                      {checkoutLoading === plan ? t('redirecting') : t('selectPlan')}
                    </Button>
                  )}
                  {isDowngrade && (
                    <p className="text-xs text-muted-foreground text-center py-1">
                      {plan === 'free' ? t('cancelToDowngrade') : t('contactToDowngrade')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t('stripeNotice')}</p>
        </CardContent>
      </Card>

      {/* Cancel confirmation */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {periodEndDate
                ? t('cancelConfirm', { date: periodEndDate.toLocaleDateString() })
                : t('cancelConfirmGeneric')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepSubscription')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? t('cancelling') : t('cancelSubscription')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── invoices section ─────────────────────────────────────────────────────────

function InvoicesSection({ teamId, hasGateway }: { teamId: string; hasGateway: boolean }) {
  const t = useTranslations('Billing')
  const { data: invoices = [], isLoading } = useInvoices(teamId, hasGateway)

  if (!hasGateway) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {t('invoices')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
          </div>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t('noInvoices')}</p>
        ) : (
          <div className="divide-y">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{formatCurrency(inv.amount, inv.currency)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(inv.created).toLocaleDateString()}</p>
                </div>
                <Badge variant={inv.status === 'paid' ? 'default' : 'outline'} className="text-xs capitalize">
                  {inv.status}
                </Badge>
                <div className="flex items-center gap-1.5">
                  {inv.hostedUrl && (
                    <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground underline">
                      {t('invoiceView')}
                    </a>
                  )}
                  {inv.pdfUrl && (
                    <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── org-managed banner ───────────────────────────────────────────────────────

function ManagedByOrgBanner({ orgId }: { orgId: string }) {
  const { data: orgDoc } = useQuery<{ name: string } | null>({
    queryKey: ['org-name', orgId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'organizations', orgId))
      return snap.exists() ? { name: snap.data().name as string } : null
    },
  })

  return (
    <div className="rounded-lg border bg-muted/40 p-5 flex items-start gap-3">
      <CreditCard className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-sm">Billing managed by organization</p>
        {orgDoc?.name && (
          <p className="text-sm text-muted-foreground mt-0.5">
            Your plan is managed by <strong>{orgDoc.name}</strong>. Contact your organization
            administrator for billing details or plan changes.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

// ─── trial extension card ──────────────────────────────────────────────────────

function TrialExtendCard({ team, teamId }: { team: Team | null; teamId: string }) {
  const t = useTranslations('Billing')
  const [loading, setLoading] = useState(false)

  // Only during a trial that hasn't already been extended.
  if (!team || team.plan_status !== 'trial' || team.trial_extended) return null

  const endMs = toTs(team.trial_ends_at)
  const endDate = endMs ? new Date(endMs).toLocaleDateString() : null

  async function extend() {
    setLoading(true)
    try {
      await httpsCallable<{ teamId: string }>(functions, 'extendTrial')({ teamId })
      toast.success(t('trialExtendedToast', { days: TRIAL_EXTENSION_DAYS }))
      // team doc updates in real time via AuthContext → this card self-hides.
    } catch {
      toast.error(t('trialExtendError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-5 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-semibold">{t('trialExtendTitle')}</p>
          <p className="text-sm text-muted-foreground">
            {endDate ? t('trialExtendBody', { days: TRIAL_EXTENSION_DAYS, date: endDate }) : t('trialExtendBodyNoDate', { days: TRIAL_EXTENSION_DAYS })}
          </p>
        </div>
        <Button onClick={extend} disabled={loading} className="shrink-0">
          {loading ? t('trialExtending') : t('trialExtendCta', { days: TRIAL_EXTENSION_DAYS })}
        </Button>
      </CardContent>
    </Card>
  )
}

export default function BillingPage() {
  const { user, currentTeamId, team } = useAuth()
  const t = useTranslations('Billing')

  const { data: isOwner, isLoading: roleLoading } = useIsOwner(currentTeamId, user?.uid ?? null)
  const { data: sub, isLoading: subLoading } = useSubscription(currentTeamId)

  if (roleLoading || subLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold tracking-tight mb-1">{t('title')}</h1>
        <div className="rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t('ownerOnly')}</p>
        </div>
      </div>
    )
  }

  const orgId = team?.org_id
  if (orgId) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
        </div>
        <ManagedByOrgBanner orgId={orgId} />
      </div>
    )
  }

  const hasGateway = !!sub?.gateway_type

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
      </div>

      <Suspense fallback={null}>
        <CheckoutBanner />
      </Suspense>

      <TrialExtendCard team={team} teamId={currentTeamId!} />
      <SubscriptionCard sub={sub ?? null} team={team} teamId={currentTeamId!} />
      <InvoicesSection teamId={currentTeamId!} hasGateway={hasGateway} />
    </div>
  )
}
