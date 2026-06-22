'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useParams, useSearchParams } from 'next/navigation'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useOrg } from '@/contexts/OrgContext'
import { useQuery } from '@tanstack/react-query'
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
import { CreditCard, CheckCircle2, AlertTriangle, FileText, ExternalLink } from 'lucide-react'
import { useLocale } from 'next-intl'

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

// ─── helpers ──────────────────────────────────────────────────────────────────

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default'
  if (status === 'trial') return 'secondary'
  if (status === 'past_due' || status === 'cancelled') return 'destructive'
  return 'outline'
}

function formatDate(ts: { seconds: number } | null | undefined) {
  if (!ts) return ''
  return new Date(ts.seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100)
}

// ─── invoices ─────────────────────────────────────────────────────────────────

function InvoicesSection({ orgId, hasGateway }: { orgId: string; hasGateway: boolean }) {
  const t = useTranslations('OrgBilling')
  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ['saas-invoices', orgId],
    enabled: hasGateway,
    queryFn: async () => {
      const fn = httpsCallable<{ teamId: string }, { invoices: Invoice[] }>(functions, 'getSaasInvoices')
      const result = await fn({ teamId: orgId })
      return result.data.invoices
    },
  })

  if (!hasGateway) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {t('invoicesTitle')}
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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function OrgBillingPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const t = useTranslations('OrgBilling')
  const locale = useLocale()
  const searchParams = useSearchParams()
  const checkoutResult = searchParams.get('checkout')

  const { subscription, loading, isAdmin } = useOrg()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function handleSubscribe() {
    setActionLoading(true)
    try {
      const fn = httpsCallable<
        { orgId: string; locale: string; origin?: string },
        { url: string }
      >(functions, 'createOrgCheckoutSession')
      const result = await fn({
        orgId: orgId,
        locale,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      })
      const url = result.data.url
      if (!url.startsWith('https://checkout.stripe.com')) {
        throw new Error('Unexpected redirect URL')
      }
      window.location.href = url
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error')
      setActionLoading(false)
    }
  }

  async function handleCancel() {
    setActionLoading(true)
    try {
      const fn = httpsCallable(functions, 'cancelSaasSubscription')
      await fn({ teamId: orgId })
      showToast(t('cancelSuccess'))
      setCancelOpen(false)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReactivate() {
    setActionLoading(true)
    try {
      const fn = httpsCallable(functions, 'reactivateSaasSubscription')
      await fn({ teamId: orgId })
      showToast(t('reactivateSuccess'))
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleUpdatePayment() {
    setActionLoading(true)
    try {
      const fn = httpsCallable<{ teamId: string; returnUrl: string }, { url: string }>(functions, 'getBillingPortalUrl')
      const result = await fn({ teamId: orgId, returnUrl: window.location.href })
      const url = result.data.url
      if (!url.startsWith('https://billing.stripe.com/')) throw new Error('Unexpected URL')
      window.location.href = url
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error')
      setActionLoading(false)
    }
  }

  const status = subscription?.status ?? 'trial'
  const hasActiveSubscription = status === 'active' || status === 'past_due'
  const isCancelling = subscription?.cancel_at_period_end === true
  const hasGateway = !!subscription?.gateway_type

  const periodStart = subscription?.current_period_start as { seconds: number } | null | undefined
  const periodEnd = subscription?.current_period_end as { seconds: number } | null | undefined

  return (
    <div className="space-y-6">
      {checkoutResult === 'success' && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {t('checkoutSuccess')}
        </div>
      )}

      <h2 className="text-lg font-semibold">{t('title')}</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            {t('planLabel')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-lg capitalize">Organization</span>
                <Badge variant={statusVariant(status)}>
                  {status === 'trial' ? t('statusTrial')
                    : status === 'active' ? t('statusActive')
                    : status === 'past_due' ? t('statusPastDue')
                    : t('statusCancelled')}
                </Badge>
                {isCancelling && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    {t('cancelAtPeriodEnd')}
                  </Badge>
                )}
              </div>

              {/* Trial end */}
              {status === 'trial' && subscription?.trial_ends_at && (
                <p className="text-sm text-muted-foreground">
                  {t('trialEnds', { date: formatDate(subscription.trial_ends_at as { seconds: number }) })}
                </p>
              )}

              {/* Billing period */}
              {status !== 'trial' && periodStart && periodEnd && (
                <p className="text-sm text-muted-foreground">
                  {t('periodLabel')}: {formatDate(periodStart)} – {formatDate(periodEnd)}
                </p>
              )}

              {/* Access until (cancelling) */}
              {isCancelling && periodEnd && (
                <p className="text-sm text-amber-600">
                  {t('activeUntil', { date: formatDate(periodEnd) })}
                </p>
              )}

              {/* Past due warning */}
              {status === 'past_due' && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2.5 flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  {t('pastDueWarning')}
                </div>
              )}

              {isAdmin && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {!hasActiveSubscription && !isCancelling && (
                    <Button onClick={handleSubscribe} disabled={actionLoading}>
                      {actionLoading ? '…' : t('upgradeButton')}
                    </Button>
                  )}
                  {isCancelling && (
                    <Button variant="outline" onClick={handleReactivate} disabled={actionLoading}>
                      {actionLoading ? '…' : t('reactivate')}
                    </Button>
                  )}
                  {hasActiveSubscription && hasGateway && (
                    <Button variant="ghost" size="sm" onClick={handleUpdatePayment} disabled={actionLoading}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      {t('updatePayment')}
                    </Button>
                  )}
                  {hasActiveSubscription && !isCancelling && (
                    <Button
                      variant="outline"
                      onClick={() => setCancelOpen(true)}
                      disabled={actionLoading}
                    >
                      {t('cancelButton')}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <InvoicesSection orgId={orgId} hasGateway={hasGateway} />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cancelConfirmMessage')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>{t('cancel' as Parameters<typeof t>[0])}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} disabled={actionLoading}>
              {actionLoading ? '…' : t('cancelConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white bg-green-600 z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
