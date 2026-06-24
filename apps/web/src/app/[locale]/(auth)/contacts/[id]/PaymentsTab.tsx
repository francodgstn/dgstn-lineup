'use client'

// Per-contact Payments tab — this contact's payments across both rails (Connect
// member_payments + BYO payment_events), merged into one timeline. A manager can
// edit the comment or reassign the payment to another contact (same
// updatePaymentRecord callable as the general payments page).
//
// Also surfaces the contact's Stripe recurring subscriptions (member_subscriptions)
// with freeze / resume billing actions.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, Pencil, Snowflake, Play } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db, functions } from '@/lib/firebase'
import type { Contact, MemberSubscription, SubscriptionRollupStatus } from '@linyup/shared'
import {
  SUBSCRIPTION_ROLLUP_STATUSES,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
} from '@linyup/shared'
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

// ─── payment status styles ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  partially_refunded: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  refunded: 'bg-muted text-muted-foreground',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  pending: 'bg-muted text-muted-foreground',
}

// ─── rollup badge ─────────────────────────────────────────────────────────────

const ROLLUP_BADGE_STYLES: Record<SubscriptionRollupStatus, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  past_due: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  paused: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  none: 'bg-muted text-muted-foreground',
}

function RollupBadge({
  status,
  t,
}: {
  status: SubscriptionRollupStatus
  t: ReturnType<typeof useTranslations<'PaymentsDashboard'>>
}) {
  if (status === 'none') return null
  return (
    <Badge
      variant="secondary"
      className={`text-xs ${ROLLUP_BADGE_STYLES[status]}`}
    >
      {t(`subStatus_${status}` as `subStatus_${SubscriptionRollupStatus}`)}
    </Badge>
  )
}

// ─── member subscriptions hook ────────────────────────────────────────────────

function useContactMemberSubscriptions(teamId: string | null, contactId: string) {
  return useQuery<Array<MemberSubscription & { id: string }>>({
    queryKey: ['contact-member-subscriptions', teamId, contactId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, TEAMS_COLLECTION, teamId!, MEMBER_SUBSCRIPTIONS_SUBCOLLECTION),
          where('contactId', '==', contactId)
        )
      )
      return snap.docs.map((d) => ({ ...(d.data() as MemberSubscription), id: d.id }))
    },
  })
}

// ─── freeze / resume mutations ────────────────────────────────────────────────

function usePauseMemberSubscription(teamId: string | null, contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const fn = httpsCallable<{ teamId: string; subscriptionId: string }, { ok: boolean }>(
        functions,
        'pauseMemberSubscription'
      )
      return (await fn({ teamId: teamId!, subscriptionId })).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-member-subscriptions', teamId, contactId] })
      qc.invalidateQueries({ queryKey: ['contact', contactId] })
    },
  })
}

function useResumeMemberSubscription(teamId: string | null, contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const fn = httpsCallable<{ teamId: string; subscriptionId: string }, { ok: boolean }>(
        functions,
        'resumeMemberSubscription'
      )
      return (await fn({ teamId: teamId!, subscriptionId })).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact-member-subscriptions', teamId, contactId] })
      qc.invalidateQueries({ queryKey: ['contact', contactId] })
    },
  })
}

// ─── member subscriptions section ─────────────────────────────────────────────

function MemberSubscriptionsSection({
  teamId,
  contactId,
  t,
}: {
  teamId: string
  contactId: string
  t: ReturnType<typeof useTranslations<'PaymentsDashboard'>>
}) {
  const { data: subs = [], isLoading } = useContactMemberSubscriptions(teamId, contactId)
  const pause = usePauseMemberSubscription(teamId, contactId)
  const resume = useResumeMemberSubscription(teamId, contactId)

  // Confirm dialog state: null = closed, string = subscriptionId to freeze
  const [freezeTarget, setFreezeTarget] = useState<string | null>(null)

  // Only show recurring subscriptions (those that have a Stripe subscriptionId)
  const recurringOnly = subs.filter((s) => !!s.subscriptionId)

  if (isLoading) {
    return <Skeleton className="h-16 rounded" />
  }

  if (recurringOnly.length === 0) {
    return (
      <p className="py-4 text-sm text-center text-muted-foreground">
        {t('noMemberSubscriptions')}
      </p>
    )
  }

  function isBillingPaused(sub: MemberSubscription) {
    return !!sub.pause_collection
  }

  function canFreeze(sub: MemberSubscription) {
    return (
      (sub.status === 'active' || sub.status === 'trialing') && !isBillingPaused(sub)
    )
  }

  return (
    <>
      <div className="rounded-lg border divide-y">
        {recurringOnly.map((sub) => {
          const paused = isBillingPaused(sub)
          const freezable = canFreeze(sub)
          const resumable = paused

          return (
            <div key={sub.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {formatMoneyMinor(sub.amount, sub.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sub.subscriptionId}
                </p>
              </div>
              <Badge
                variant="secondary"
                className={
                  paused
                    ? ROLLUP_BADGE_STYLES.paused
                    : sub.status === 'active'
                      ? ROLLUP_BADGE_STYLES.active
                      : sub.status === 'trialing'
                        ? ROLLUP_BADGE_STYLES.trialing
                        : sub.status === 'past_due'
                          ? ROLLUP_BADGE_STYLES.past_due
                          : 'bg-muted text-muted-foreground'
                }
              >
                {paused ? t('subStatus_paused') : sub.status}
              </Badge>
              {freezable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFreezeTarget(sub.id)}
                  disabled={pause.isPending}
                >
                  <Snowflake className="h-3.5 w-3.5 mr-1.5" />
                  {t('freezeBilling')}
                </Button>
              )}
              {resumable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resume.mutate(sub.id)}
                  disabled={resume.isPending}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {t('resumeBilling')}
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {/* Freeze confirm dialog */}
      <AlertDialog open={freezeTarget !== null} onOpenChange={(open) => { if (!open) setFreezeTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('freezeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('freezeConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (freezeTarget) {
                  pause.mutate(freezeTarget)
                  setFreezeTarget(null)
                }
              }}
              disabled={pause.isPending}
            >
              {t('freezeConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── main component ────────────────────────────────────────────────────────────

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

  // Determine whether Connect is in play: show subscriptions section only
  // when there's a teamId (subscriptions section guards internally via isLoading/empty).
  const showSubscriptions = !!tid

  const rollupStatus = contact.subscription_status as SubscriptionRollupStatus | undefined

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

  return (
    <div className="p-4 sm:p-5 space-y-6">
      {/* ── Stripe billing (member_subscriptions) ── */}
      {showSubscriptions && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('memberSubscriptionsHeading')}
            </p>
            {rollupStatus && SUBSCRIPTION_ROLLUP_STATUSES.includes(rollupStatus) && (
              <RollupBadge status={rollupStatus} t={t} />
            )}
          </div>
          <MemberSubscriptionsSection
            teamId={tid}
            contactId={contact.id}
            t={t}
          />
        </div>
      )}

      {/* ── Payment history ── */}
      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <CreditCard className="h-6 w-6 mx-auto mb-2 opacity-40" />
          {t('contactNoPayments')}
        </div>
      ) : (
        <div className="space-y-3">
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
        </div>
      )}

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
