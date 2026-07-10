'use client'

// Shared unified-payments table (Connect + BYO/manual rails) used by the general
// /payments page AND the contact detail Payments tab — one component so the two
// views never drift. Columns: date, "what was paid" (line item / comment), an
// optional contact column (hidden on contact-scoped views), source gateway
// (+ manual payment mode), status, amount, and per-row actions (assign/edit +
// an optional refund for Connect rows).

import { useTranslations } from 'next-intl'
import { Pencil, UserPlus } from 'lucide-react'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import {
  paymentLabel,
  paymentNote,
  formatMoneyMinor,
  formatPaymentDate,
  type UnifiedPaymentRow,
} from '@/lib/payments'
import type { AssignPaymentTarget } from '@/components/payments/AssignPaymentDialog'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  partially_refunded: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  refunded: 'bg-muted text-muted-foreground',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  pending: 'bg-muted text-muted-foreground',
}

export function PaymentsTable({
  rows,
  showContact = true,
  contactName,
  onAssign,
  onRefund,
}: {
  rows: UnifiedPaymentRow[]
  /** Hide the contact column on contact-scoped views (it's redundant there). */
  showContact?: boolean
  /** Resolve a contact id to a display name (general payments page). */
  contactName?: (id: string) => string | undefined
  onAssign: (target: AssignPaymentTarget) => void
  /** When provided, refundable Connect rows get a Refund action. */
  onRefund?: (row: UnifiedPaymentRow) => void
}) {
  const t = useTranslations('PaymentsDashboard')

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colDate')}</TableHead>
              <TableHead>{t('colDetails')}</TableHead>
              {showContact && <TableHead>{t('colContact')}</TableHead>}
              <TableHead>{t('colSource')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead className="text-right">{t('colAmount')}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatPaymentDate(row.createdAt)}
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <div className="truncate font-medium">{paymentLabel(row)}</div>
                  {paymentNote(row) && (
                    <div className="truncate text-xs text-muted-foreground">{paymentNote(row)}</div>
                  )}
                  {row.source === 'connect' && row.feeAmount > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {t('fee')} {formatMoneyMinor(row.feeAmount, row.currency)}
                    </div>
                  )}
                </TableCell>
                {showContact && (
                  <TableCell className="max-w-[180px]">
                    {row.assigned ? (
                      row.contactId ? (
                        <Link
                          href={`/contacts/${row.contactId}?tab=payments` as Route}
                          className="block truncate text-primary hover:underline"
                        >
                          {contactName?.(row.contactId) ?? '—'}
                        </Link>
                      ) : (
                        <span className="block truncate">—</span>
                      )
                    ) : (
                      <>
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                          {t('unassigned')}
                        </Badge>
                        {row.email && (
                          <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                        )}
                      </>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <Badge variant="outline" className="text-muted-foreground">
                    {t(`gateway_${row.gateway}` as never)}
                  </Badge>
                  {row.paymentMode && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{row.paymentMode}</div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {row.disputed && (
                      <Badge variant="outline" className="text-red-700 border-red-300">
                        {t('disputed')}
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className={PAYMENT_STATUS_STYLES[row.status] ?? 'bg-muted'}
                    >
                      {row.source === 'byo' ? t('status_paid') : t(`status_${row.status}` as never)}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  <div className="font-medium">{formatMoneyMinor(row.amount, row.currency)}</div>
                  {row.amountRefunded > 0 && (
                    <div className="text-xs text-muted-foreground">
                      -{formatMoneyMinor(row.amountRefunded, row.currency)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onAssign({
                          source: row.source,
                          paymentId: row.paymentId,
                          contactId: row.contactId,
                          comment: row.comment,
                          lineItem: row.lineItem,
                        })
                      }
                    >
                      {row.assigned ? (
                        <Pencil className="h-3.5 w-3.5" />
                      ) : (
                        <>
                          <UserPlus className="h-3.5 w-3.5 mr-1" />
                          {t('assign')}
                        </>
                      )}
                    </Button>
                    {onRefund && row.refundable && (
                      <Button size="sm" variant="outline" onClick={() => onRefund(row)}>
                        {t('refund')}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
