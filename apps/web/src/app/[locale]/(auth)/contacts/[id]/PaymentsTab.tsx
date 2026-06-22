'use client'

// Per-contact Payments tab — this contact's payments across both rails (Connect
// member_payments + BYO payment_events), merged into one timeline. A manager can
// edit the comment or reassign the payment to another contact (same
// updatePaymentRecord callable as the general payments page).

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, Pencil } from 'lucide-react'
import type { Contact } from '@linyup/shared'
import { useContactPayments } from '@/hooks/useConnect'
import {
  connectToUnified,
  byoToUnified,
  mergePaymentRows,
  paymentLabel,
  formatMoneyMinor,
  formatPaymentDate,
} from '@/lib/payments'
import { AssignPaymentDialog, type AssignPaymentTarget } from '@/components/payments/AssignPaymentDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  partially_refunded: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  refunded: 'bg-muted text-muted-foreground',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  pending: 'bg-muted text-muted-foreground',
}

export function PaymentsTab({
  contact,
  teamId,
}: {
  contact: Contact & { id: string }
  teamId: string | null | undefined
}) {
  const t = useTranslations('PaymentsDashboard')
  const tid = teamId ?? null
  const { data, isLoading } = useContactPayments(tid, contact.id)
  const [assignTarget, setAssignTarget] = useState<AssignPaymentTarget | null>(null)

  const rows = useMemo(
    () =>
      mergePaymentRows(
        connectToUnified(data?.payments ?? []),
        byoToUnified(data?.events ?? [])
      ),
    [data]
  )

  if (isLoading) {
    return (
      <div className="p-5">
        <Skeleton className="h-24 rounded" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <CreditCard className="h-6 w-6 mx-auto mb-2 opacity-40" />
        {t('contactNoPayments')}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-5">
      <div className="rounded-lg border divide-y">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{paymentLabel(row)}</p>
              <p className="text-xs text-muted-foreground">
                {formatPaymentDate(row.createdAt)}
                {row.amountRefunded > 0 && (
                  <> · {t('refunded')} {formatMoneyMinor(row.amountRefunded, row.currency)}</>
                )}
              </p>
            </div>
            <Badge variant="outline" className="hidden sm:inline-flex text-muted-foreground">
              {t(`gateway_${row.gateway}` as never)}
            </Badge>
            <Badge variant="secondary" className={STATUS_STYLES[row.status] ?? 'bg-muted'}>
              {row.source === 'byo' ? t('status_paid') : t(`status_${row.status}` as never)}
            </Badge>
            <span className="text-sm font-medium tabular-nums">
              {formatMoneyMinor(row.amount, row.currency)}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setAssignTarget({
                  source: row.source,
                  paymentId: row.paymentId,
                  contactId: row.contactId,
                  comment: row.comment,
                })
              }
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {tid && (
        <AssignPaymentDialog
          teamId={tid}
          target={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  )
}
