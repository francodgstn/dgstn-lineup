'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { TEAMS_COLLECTION } from '@lineup/shared'
import type { SaasSubscription } from '@lineup/shared'
import { CreditCard, FileText, ExternalLink, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  amount: number
  currency: string
  status: string
  created: string  // ISO string from function response
  hostedUrl?: string
  pdfUrl?: string
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
      const fns = getFunctions(undefined, 'europe-west6')
      const getSaasInvoices = httpsCallable<{ teamId: string }, { invoices: Invoice[] }>(fns, 'getSaasInvoices')
      const result = await getSaasInvoices({ teamId: teamId! })
      return result.data.invoices
    },
  })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('de-CH', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 2 }).format(amount / 100)
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

// ─── subscription card ────────────────────────────────────────────────────────

function SubscriptionCard({ sub, teamId }: { sub: SaasSubscription | null; teamId: string }) {
  const t = useTranslations('Billing')
  const [cancelling, setCancelling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  const plans = ['coach', 'club', 'organization'] as const

  async function handleUpgrade(plan: string) {
    setCheckoutLoading(plan)
    try {
      const fns = getFunctions(undefined, 'europe-west6')
      const createCheckout = httpsCallable<{ teamId: string; plan: string }, { url: string }>(fns, 'createCheckoutSession')
      const result = await createCheckout({ teamId, plan })
      window.location.href = result.data.url
    } catch (err) {
      console.error('Checkout failed:', err)
    } finally {
      setCheckoutLoading(null)
    }
  }

  async function handleCancel() {
    setCancelling(true)
    try {
      const fns = getFunctions(undefined, 'europe-west6')
      const cancelFn = httpsCallable<{ teamId: string }>(fns, 'cancelSaasSubscription')
      await cancelFn({ teamId })
      setConfirmCancel(false)
      window.location.reload()
    } catch (err) {
      console.error('Cancel failed:', err)
    } finally {
      setCancelling(false)
    }
  }

  const periodEnd = sub?.current_period_end
    ? new Date((sub.current_period_end as unknown as { seconds: number }).seconds * 1000)
    : null

  const trialEnd = sub?.trial_ends_at
    ? new Date((sub.trial_ends_at as unknown as { seconds: number }).seconds * 1000)
    : null

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
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <StatusIcon status={sub.status} />
                <span className="font-semibold capitalize">{sub.plan} plan</span>
                <Badge variant={statusVariant(sub.status)} className="capitalize">{sub.status}</Badge>
                {sub.cancel_at_period_end && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">{t('cancelAtPeriodEnd')}</Badge>
                )}
              </div>

              {trialEnd && sub.status === 'trial' && (
                <p className="text-sm text-muted-foreground">
                  {t('trialEnds', { date: trialEnd.toLocaleDateString() })}
                </p>
              )}
              {periodEnd && sub.status !== 'trial' && (
                <p className="text-sm text-muted-foreground">
                  {sub.cancel_at_period_end ? t('accessUntil', { date: periodEnd.toLocaleDateString() }) : t('nextBilling', { date: periodEnd.toLocaleDateString() })}
                </p>
              )}

              {sub.status === 'active' && !sub.cancel_at_period_end && (
                <button
                  className="text-xs text-muted-foreground hover:text-destructive underline"
                  onClick={() => setConfirmCancel(true)}
                >
                  {t('cancelSubscription')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('noSubscription')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('choosePlan')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = sub?.plan === plan
              return (
                <div
                  key={plan}
                  className={`rounded-lg border p-4 space-y-3 ${isCurrent ? 'border-primary bg-primary/5' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold capitalize">{plan}</p>
                    {isCurrent && <Badge variant="default" className="text-xs">{t('currentPlanBadge')}</Badge>}
                  </div>
                  {!isCurrent && (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!!checkoutLoading}
                      onClick={() => handleUpgrade(plan)}
                    >
                      {checkoutLoading === plan ? t('redirecting') : t('selectPlan')}
                    </Button>
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
              {periodEnd ? t('cancelConfirm', { date: periodEnd.toLocaleDateString() }) : t('cancelConfirmGeneric')}
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

// ─── invoices table ───────────────────────────────────────────────────────────

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
                <Badge variant={inv.status === 'paid' ? 'default' : 'outline'} className="text-xs capitalize">{inv.status}</Badge>
                {inv.pdfUrl && (
                  <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { user, currentTeamId } = useAuth()
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

  const hasGateway = !!sub?.gateway_type

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
      </div>

      <SubscriptionCard sub={sub ?? null} teamId={currentTeamId!} />
      <InvoicesSection teamId={currentTeamId!} hasGateway={hasGateway} />
    </div>
  )
}
