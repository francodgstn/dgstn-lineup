'use client'

// Payments dashboard — Stripe Connect member payments + subscriptions for the
// current team (read-only mirror of Stripe, reconciled by the webhook). Managers
// and owners can refund one-off payments here; dispute status is surfaced inline.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, Loader2 } from 'lucide-react'
import type { MemberPayment } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMemberPayments,
  useMemberSubscriptions,
  useRefundMemberPayment,
} from '@/hooks/useConnect'
import { Card, CardContent } from '@/components/ui/card'
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

function formatChf(rappen: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'CHF' }).format(
    (rappen ?? 0) / 100
  )
}

function formatDate(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | undefined)?.toDate?.()
  return d ? d.toLocaleDateString() : ''
}

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  partially_refunded: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  refunded: 'bg-muted text-muted-foreground',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  pending: 'bg-muted text-muted-foreground',
}

export default function PaymentsDashboardPage() {
  const t = useTranslations('PaymentsDashboard')
  const { currentTeamId } = useAuth()
  const teamId = currentTeamId ?? null

  const { data: payments = [], isLoading } = useMemberPayments(teamId)
  const { data: subscriptions = [] } = useMemberSubscriptions(teamId)
  const refund = useRefundMemberPayment()
  const [refundTarget, setRefundTarget] = useState<MemberPayment | null>(null)

  async function confirmRefund() {
    if (!refundTarget || !teamId) return
    await refund.mutateAsync({ teamId, paymentIntentId: refundTarget.paymentIntentId })
    setRefundTarget(null)
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t('title')}</h1>
      </div>

      {/* One-off payments */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('paymentsHeading')}</h2>
        {isLoading ? (
          <Skeleton className="h-24 rounded" />
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t('noPayments')}</p>
        ) : (
          <Card>
            <CardContent className="p-0 divide-y">
              {payments.map((p) => {
                const refundable =
                  p.status === 'succeeded' || p.status === 'partially_refunded'
                return (
                  <div key={p.paymentIntentId} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.purpose || t('payment')}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(p.created_at)} · {t('fee')} {formatChf(p.application_fee_amount)}
                        {p.amount_refunded > 0 && (
                          <> · {t('refunded')} {formatChf(p.amount_refunded)}</>
                        )}
                      </p>
                    </div>
                    {p.dispute_status && (
                      <Badge variant="outline" className="text-red-700 border-red-300">
                        {t('disputed')}
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className={PAYMENT_STATUS_STYLES[p.status] ?? 'bg-muted'}
                    >
                      {t(`status_${p.status}` as never)}
                    </Badge>
                    <span className="text-sm font-medium tabular-nums">{formatChf(p.amount)}</span>
                    {refundable && (
                      <Button size="sm" variant="outline" onClick={() => setRefundTarget(p)}>
                        {t('refund')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Recurring memberships */}
      {subscriptions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">{t('subscriptionsHeading')}</h2>
          <Card>
            <CardContent className="p-0 divide-y">
              {subscriptions.map((s) => (
                <div key={s.subscriptionId} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{t('membership')}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatChf(s.amount)} · {s.status}
                    </p>
                  </div>
                  <Badge variant="secondary">{s.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <AlertDialog open={!!refundTarget} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('refundConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {refundTarget && t('refundConfirmBody', { amount: formatChf(refundTarget.amount) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRefund} disabled={refund.isPending}>
              {refund.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('refund')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
