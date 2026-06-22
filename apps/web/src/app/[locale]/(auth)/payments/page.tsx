'use client'

// Payments dashboard — Stripe Connect member payments + subscriptions for the
// current team (read-only mirror of Stripe, reconciled by the webhook). Managers
// and owners can refund one-off payments here; dispute status is surfaced inline.

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { CreditCard, Loader2, Plus, Copy, Check, UserPlus, Pencil } from 'lucide-react'
import type { SubscriptionType } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import {
  useMemberPayments,
  useMemberSubscriptions,
  usePaymentEvents,
  useRefundMemberPayment,
  useCreateMembershipPayment,
} from '@/hooks/useConnect'
import { useActiveContacts } from '@/hooks/useActiveContacts'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import {
  connectToUnified,
  byoToUnified,
  mergePaymentRows,
  paymentLabel,
  formatMoneyMinor,
  formatPaymentDate,
  type UnifiedPaymentRow,
} from '@/lib/payments'
import { AssignPaymentDialog, type AssignPaymentTarget } from '@/components/payments/AssignPaymentDialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
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
  const { data: events = [], isLoading: loadingEvents } = usePaymentEvents(teamId)
  const { data: subscriptions = [] } = useMemberSubscriptions(teamId)
  const { data: contacts = [] } = useActiveContacts(teamId)
  const refund = useRefundMemberPayment()

  const [refundTarget, setRefundTarget] = useState<UnifiedPaymentRow | null>(null)
  const [assignTarget, setAssignTarget] = useState<AssignPaymentTarget | null>(null)
  const [filter, setFilter] = useState<'all' | 'unassigned'>('all')

  const contactName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contacts) {
      m.set(c.id, `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim() || c.email || c.id)
    }
    return m
  }, [contacts])

  const rows = useMemo(
    () => mergePaymentRows(connectToUnified(payments), byoToUnified(events)),
    [payments, events]
  )
  const unassignedCount = rows.filter((r) => !r.assigned).length
  const visible = filter === 'unassigned' ? rows.filter((r) => !r.assigned) : rows
  const loading = isLoading || loadingEvents

  async function confirmRefund() {
    if (!refundTarget || !teamId) return
    await refund.mutateAsync({ teamId, paymentIntentId: refundTarget.paymentId })
    setRefundTarget(null)
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t('title')}</h1>
        </div>
        {teamId && <CreatePaymentLinkDialog teamId={teamId} />}
      </div>

      {/* Filter: all / unassigned */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          {t('filterAll')}
        </Button>
        <Button
          size="sm"
          variant={filter === 'unassigned' ? 'default' : 'outline'}
          onClick={() => setFilter('unassigned')}
        >
          {t('filterUnassigned')}
          {unassignedCount > 0 && (
            <Badge variant="secondary" className="ml-1.5">
              {unassignedCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Payments (Connect + BYO, unified) */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t('paymentsHeading')}</h2>
        {loading ? (
          <Skeleton className="h-24 rounded" />
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {filter === 'unassigned' ? t('noUnassigned') : t('noPayments')}
          </p>
        ) : (
          <Card>
            <CardContent className="p-0 divide-y">
              {visible.map((row) => (
                <div key={row.key} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{paymentLabel(row)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatPaymentDate(row.createdAt)}
                      {row.source === 'connect' && row.feeAmount > 0 && (
                        <> · {t('fee')} {formatMoneyMinor(row.feeAmount, row.currency)}</>
                      )}
                      {row.amountRefunded > 0 && (
                        <> · {t('refunded')} {formatMoneyMinor(row.amountRefunded, row.currency)}</>
                      )}
                    </p>
                    <p className="text-xs mt-0.5">
                      {row.assigned ? (
                        <span className="text-muted-foreground">
                          {row.contactId ? contactName.get(row.contactId) ?? '—' : '—'}
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                          {t('unassigned')}
                          {row.email ? ` · ${row.email}` : ''}
                        </Badge>
                      )}
                    </p>
                  </div>

                  <Badge variant="outline" className="hidden sm:inline-flex text-muted-foreground">
                    {t(`gateway_${row.gateway}` as never)}
                  </Badge>
                  {row.disputed && (
                    <Badge variant="outline" className="text-red-700 border-red-300">
                      {t('disputed')}
                    </Badge>
                  )}
                  <Badge variant="secondary" className={PAYMENT_STATUS_STYLES[row.status] ?? 'bg-muted'}>
                    {row.source === 'byo' ? t('status_paid') : t(`status_${row.status}` as never)}
                  </Badge>
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoneyMinor(row.amount, row.currency)}
                  </span>

                  {/* Assign / edit (both rails) */}
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
                    {row.assigned ? (
                      <Pencil className="h-3.5 w-3.5" />
                    ) : (
                      <>
                        <UserPlus className="h-3.5 w-3.5 mr-1" />
                        {t('assign')}
                      </>
                    )}
                  </Button>

                  {/* Refund (Connect only) */}
                  {row.refundable && (
                    <Button size="sm" variant="outline" onClick={() => setRefundTarget(row)}>
                      {t('refund')}
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Recurring memberships (Connect) */}
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
                      {formatMoneyMinor(s.amount, s.currency)} · {s.status}
                    </p>
                  </div>
                  <Badge variant="secondary">{s.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {teamId && (
        <AssignPaymentDialog
          teamId={teamId}
          target={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}

      <AlertDialog open={!!refundTarget} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('refundConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {refundTarget &&
                t('refundConfirmBody', {
                  amount: formatMoneyMinor(refundTarget.amount, refundTarget.currency),
                })}
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

// ─── create payment link dialog ──────────────────────────────────────────────────
// Pick one of the team's subscription types + a price and a member email; the
// returned Checkout URL is shared with the member to pay.
function CreatePaymentLinkDialog({ teamId }: { teamId: string }) {
  const t = useTranslations('PaymentsDashboard')
  const tc = useTranslations('Contacts')
  const locale = useLocale()
  const { team } = useAuth()
  const currency = team?.default_currency ?? 'CHF'

  const { data: types = [] } = useSubscriptionTypes(teamId)
  const create = useCreateMembershipPayment()

  const [open, setOpen] = useState(false)
  const [typeId, setTypeId] = useState('')
  const [priceId, setPriceId] = useState('')
  const [email, setEmail] = useState('')
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const sellableTypes = useMemo(
    () => types.filter((ty) => ty.active !== false && (ty.prices ?? []).some((p) => p.active !== false)),
    [types]
  )
  const selectedType: SubscriptionType | undefined = sellableTypes.find((ty) => ty.id === typeId)
  const prices = (selectedType?.prices ?? []).filter((p) => p.active !== false)

  function fmt(amount: number) {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  }

  function reset() {
    setTypeId('')
    setPriceId('')
    setEmail('')
    setUrl('')
    setCopied(false)
  }

  async function generate() {
    if (!typeId || !priceId) return
    const res = await create.mutateAsync({
      teamId,
      subscriptionTypeId: typeId,
      priceId,
      customerEmail: email.trim() || undefined,
      locale,
    })
    setUrl(res.url)
  }

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        {t('createLink')}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createLinkTitle')}</DialogTitle>
        </DialogHeader>

        {url ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('linkReady')}</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={url} className="flex-1 text-xs" />
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('selectType')}</Label>
              <Select
                value={typeId}
                onValueChange={(v) => {
                  setTypeId(v ?? '')
                  setPriceId('')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('selectType')} />
                </SelectTrigger>
                <SelectContent>
                  {sellableTypes.map((ty) => (
                    <SelectItem key={ty.id} value={ty.id}>
                      {ty.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t('selectPrice')}</Label>
              <Select value={priceId} onValueChange={(v) => setPriceId(v ?? '')} disabled={!selectedType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectPrice')} />
                </SelectTrigger>
                <SelectContent>
                  {prices.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {fmt(p.amount)} · {tc(`recurrence_${p.recurrence}` as never)}
                      {p.included_months ? ` (${p.included_months} ${t('monthsShort')})` : ''}
                      {p.label ? ` — ${p.label}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t('memberEmail')}</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="member@example.com"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {url ? (
            <Button onClick={() => setOpen(false)}>{t('done')}</Button>
          ) : (
            <Button onClick={generate} disabled={!typeId || !priceId || create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('generate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
