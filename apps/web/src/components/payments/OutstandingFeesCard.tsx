'use client'

// No-show policy (E5) admin surface — the Payments dashboard's "Outstanding
// fees" card. Pending fees get Resend link / Waive actions; paid/waived fees
// are shown muted below so the pending queue stays scannable at a glance.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePolicyFees, useResendPolicyFeeLink, useWaivePolicyFee } from '@/hooks/usePolicyFees'
import { formatMoneyMajor, formatPaymentDate } from '@/lib/payments'
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

export function OutstandingFeesCard() {
  const t = useTranslations('PaymentsDashboard')
  const { currentTeamId, team } = useAuth()
  const currency = team?.default_currency ?? 'CHF'
  const { data: fees = [], isLoading } = usePolicyFees(currentTeamId)
  const resend = useResendPolicyFeeLink()
  const waive = useWaivePolicyFee()
  const [waiveTarget, setWaiveTarget] = useState<string | null>(null)

  const pending = useMemo(() => fees.filter((f) => f.status === 'pending'), [fees])
  const settled = useMemo(() => fees.filter((f) => f.status !== 'pending'), [fees])

  // Only surface the card once there's something to show — no policy configured,
  // no strikes yet.
  if (!isLoading && fees.length === 0) return null

  async function confirmWaive() {
    if (!currentTeamId || !waiveTarget) return
    await waive.mutateAsync({ teamId: currentTeamId, feeId: waiveTarget })
    setWaiveTarget(null)
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t('policyFeesHeading')}</h2>
      {isLoading ? (
        <Skeleton className="h-32 rounded" />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t('policyFeesEmpty')}
              </p>
            ) : (
              pending.map((f) => (
                <div key={f.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {f.contactName || t('unassigned')}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {f.created_at ? formatPaymentDate(f.created_at) : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium">
                      {formatMoneyMajor(f.amount, f.currency || currency)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => resend.mutate({ teamId: currentTeamId!, feeId: f.id })}
                      disabled={resend.isPending}
                    >
                      {t('policyFeeResend')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setWaiveTarget(f.id)}>
                      {t('policyFeeWaive')}
                    </Button>
                  </div>
                </div>
              ))
            )}

            {settled.length > 0 && (
              <div className="divide-y opacity-60">
                {settled.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{f.contactName || t('unassigned')}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {f.created_at ? formatPaymentDate(f.created_at) : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm">{formatMoneyMajor(f.amount, f.currency || currency)}</span>
                      <Badge variant="outline">
                        {t(`policyFeeStatus_${f.status}` as Parameters<typeof t>[0])}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!waiveTarget} onOpenChange={(o) => !o && setWaiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('policyFeeWaiveConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('policyFeeWaiveConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmWaive} disabled={waive.isPending}>
              {waive.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('policyFeeWaive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
