'use client'

// Payments dashboard — Stripe Connect member payments + subscriptions for the
// current team (read-only mirror of Stripe, reconciled by the webhook). Managers
// and owners can refund one-off payments here; dispute status is surfaced inline.

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { CreditCard, Loader2, Plus, Copy, Check, Search } from 'lucide-react'
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
  type UnifiedPaymentRow,
} from '@/lib/payments'
import {
  AssignPaymentDialog,
  type AssignPaymentTarget,
} from '@/components/payments/AssignPaymentDialog'
import { ExportFinanceCsvButton } from '@/components/payments/ExportFinanceCsvButton'
import { RecordPaymentDialog } from '@/components/payments/RecordPaymentDialog'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { PaymentsTable } from '@/components/payments/PaymentsTable'
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

export default function PaymentsDashboardPage() {
  const t = useTranslations('PaymentsDashboard')
  const { currentTeamId, team } = useAuth()
  const teamId = currentTeamId ?? null
  const connectReady = !!team?.payments?.connectAccountId

  // Progressive page size — "Load more" bumps it and both rails refetch. Real
  // cursor pagination / server-side filtering comes later; this keeps it usable.
  const [pageSize, setPageSize] = useState(50)

  const {
    data: payments = [],
    isLoading,
    isFetching: fetchingPayments,
  } = useMemberPayments(teamId, pageSize)
  const {
    data: events = [],
    isLoading: loadingEvents,
    isFetching: fetchingEvents,
  } = usePaymentEvents(teamId, pageSize)
  const { data: subscriptions = [] } = useMemberSubscriptions(teamId)
  const { data: contacts = [] } = useActiveContacts(teamId)
  const refund = useRefundMemberPayment()
  const { isInstalled } = useInstalledPlugins()

  const [refundTarget, setRefundTarget] = useState<UnifiedPaymentRow | null>(null)
  const [assignTarget, setAssignTarget] = useState<AssignPaymentTarget | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unassigned'>('all')
  const [search, setSearch] = useState('')

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

  // Apply the all/unassigned filter + free-text search (over the loaded rows).
  const filtered = useMemo(() => {
    let list = filter === 'unassigned' ? rows.filter((r) => !r.assigned) : rows
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((r) =>
        [
          paymentLabel(r),
          r.paymentMode ?? '',
          r.contactId ? (contactName.get(r.contactId) ?? '') : '',
          r.email ?? '',
          r.comment ?? '',
          (r.amount / 100).toString(),
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    }
    return list
  }, [rows, filter, search, contactName])

  const loading = isLoading || loadingEvents
  // A full page from either rail hints there may be more to fetch.
  const hasMore = payments.length >= pageSize || events.length >= pageSize
  const fetchingMore = fetchingPayments || fetchingEvents

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
        <div className="flex items-center gap-2">
          {teamId && isInstalled('finance') && <ExportFinanceCsvButton teamId={teamId} />}
          {teamId && (
            <Button size="sm" variant="outline" onClick={() => setRecordOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              {t('recordButton')}
            </Button>
          )}
          {teamId && connectReady && <CreatePaymentLinkDialog teamId={teamId} />}
        </div>
      </div>

      {/* Toolbar: filter + search */}
      <div className="flex flex-wrap items-center gap-2">
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
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-8"
          />
        </div>
      </div>

      {/* Payments table (Connect + BYO, unified) */}
      <section className="space-y-3">
        {loading ? (
          <Skeleton className="h-40 rounded" />
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {search
              ? t('noResults')
              : filter === 'unassigned'
                ? t('noUnassigned')
                : t('noPayments')}
          </p>
        ) : (
          <>
            <PaymentsTable
              rows={filtered}
              contactName={(id) => contactName.get(id)}
              onAssign={setAssignTarget}
              onRefund={setRefundTarget}
            />

            {hasMore && (
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPageSize((p) => p + 50)}
                  disabled={fetchingMore}
                >
                  {fetchingMore && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {t('loadMore')}
                </Button>
              </div>
            )}
          </>
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

      {teamId && (
        <RecordPaymentDialog
          teamId={teamId}
          open={recordOpen}
          onClose={() => setRecordOpen(false)}
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
    () =>
      types.filter(
        (ty) => ty.active !== false && (ty.prices ?? []).some((p) => p.active !== false)
      ),
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
              <Select
                value={priceId}
                onValueChange={(v) => setPriceId(v ?? '')}
                disabled={!selectedType}
              >
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
