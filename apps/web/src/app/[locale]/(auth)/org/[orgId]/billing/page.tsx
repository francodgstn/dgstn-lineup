'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useParams, useSearchParams } from 'next/navigation'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useOrg } from '@/contexts/OrgContext'
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
import { CreditCard, CheckCircle2 } from 'lucide-react'
import { useLocale } from 'next-intl'

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
      const fn = httpsCallable<{ orgId: string; locale: string }, { url: string }>(
        functions,
        'createOrgCheckoutSession'
      )
      const result = await fn({ orgId: orgId, locale })
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
      await fn({ teamId: orgId }) // reuses same function, works for orgId too
      showToast(t('cancelSuccess'))
      setCancelOpen(false)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(false)
    }
  }

  const status = subscription?.status ?? 'trial'
  const hasActiveSubscription = status === 'active' || status === 'past_due'
  const isCancelling = subscription?.cancel_at_period_end === true

  return (
    <div className="space-y-6">
      {checkoutResult === 'success' && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Subscription activated successfully.
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
              </div>

              {status === 'trial' && subscription?.trial_ends_at && (
                <p className="text-sm text-muted-foreground">
                  {t('trialEnds', { date: formatDate(subscription.trial_ends_at as { seconds: number }) })}
                </p>
              )}

              {isCancelling && subscription?.current_period_end && (
                <p className="text-sm text-amber-600">
                  Active until {formatDate(subscription.current_period_end as { seconds: number })}
                </p>
              )}

              {isAdmin && (
                <div className="flex gap-2 pt-2">
                  {!hasActiveSubscription && !isCancelling && (
                    <Button onClick={handleSubscribe} disabled={actionLoading}>
                      {actionLoading ? '…' : t('upgradeButton')}
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
