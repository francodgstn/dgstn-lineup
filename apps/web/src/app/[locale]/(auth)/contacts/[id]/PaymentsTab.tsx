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
import { CreditCard, Snowflake, Play, Plus, Ban } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db, functions } from '@/lib/firebase'
import type { Contact, MemberSubscription, SubscriptionRollupStatus } from '@linyup/shared'
import {
  SUBSCRIPTION_ROLLUP_STATUSES,
  MEMBER_SUBSCRIPTIONS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  subscriptionEndsAtMs,
  subscriptionIsCancelling,
} from '@linyup/shared'
import { useContactPayments } from '@/hooks/useConnect'
import {
  connectToUnified,
  byoToUnified,
  mergePaymentRows,
  formatMoneyMinor,
  type UnifiedPaymentRow,
} from '@/lib/payments'
import {
  AssignPaymentDialog,
  type AssignPaymentTarget,
} from '@/components/payments/AssignPaymentDialog'
import { RecordPaymentDialog } from '@/components/payments/RecordPaymentDialog'
import { VoidPaymentDialog } from '@/components/payments/VoidPaymentDialog'
import { RefundPaymentDialog } from '@/components/payments/RefundPaymentDialog'
import { useFinanceJournal } from '@/plugins/finance/hooks'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { PaymentsTable } from '@/components/payments/PaymentsTable'
import { SubscriptionCancellationNote } from '@/components/payments/SubscriptionCancellationNote'
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
    <Badge variant="secondary" className={`text-xs ${ROLLUP_BADGE_STYLES[status]}`}>
      {t(`subStatus_${status}` as `subStatus_${SubscriptionRollupStatus}`)}
    </Badge>
  )
}

// ─── member subscriptions hook ────────────────────────────────────────────────

export function useContactMemberSubscriptions(teamId: string | null, contactId: string) {
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

/**
 * STOP THE BILLING, not just freeze it.
 *
 * Until 2026-08-23 this section could only FREEZE (`pause_collection`), and the
 * only way to cancel anything was a radio buried inside the "change
 * subscription" dialog that defaulted to KEEP. So a studio that froze a
 * membership and then removed the plan from the contact was left with a live
 * Stripe subscription nobody could see a way to stop — and the only apparent
 * exit was to RESUME the billing, which is the opposite of what they wanted.
 *
 * Offered in every live state INCLUDING paused, for that exact reason.
 */
function useCancelMemberSubscription(teamId: string | null, contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const fn = httpsCallable<{ teamId: string; subscriptionId: string }, { ok: boolean }>(
        functions,
        'cancelMemberSubscription'
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

export function MemberSubscriptionsSection({
  teamId,
  contactId,
  assignedTypeId,
  t,
}: {
  teamId: string
  contactId: string
  /** The plan the STUDIO has assigned this contact (`Contact.subscription_type_id`).
   *  Compared against what Stripe is actually billing — see the divergence
   *  notice below. Optional so a caller that has not loaded the contact simply
   *  does not raise it, rather than raising it wrongly. */
  assignedTypeId?: string | null
  t: ReturnType<typeof useTranslations<'PaymentsDashboard'>>
}) {
  const { data: subs = [], isLoading } = useContactMemberSubscriptions(teamId, contactId)
  const pause = usePauseMemberSubscription(teamId, contactId)
  const resume = useResumeMemberSubscription(teamId, contactId)
  const cancel = useCancelMemberSubscription(teamId, contactId)

  // Confirm dialog state: null = closed, string = subscriptionId to freeze
  const [freezeTarget, setFreezeTarget] = useState<string | null>(null)
  // …and the same for cancelling. Two separate pieces of state, not one with a
  // mode: freezing is reversible and cancelling is not, and a dialog that can
  // render either verb from one variable is a dialog that can render the wrong
  // one.
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)

  // Only show recurring subscriptions (those that have a Stripe subscriptionId).
  // Hide auto-cancelled duplicates (same-type re-buys the webhook refunded) — they
  // aren't real memberships, just an artefact the buyer was refunded for.
  const recurringOnly = subs.filter((s) => !!s.subscriptionId && !s.duplicate)

  if (isLoading) {
    return <Skeleton className="h-16 rounded" />
  }

  if (recurringOnly.length === 0) {
    return (
      <p className="py-4 text-sm text-center text-muted-foreground">{t('noMemberSubscriptions')}</p>
    )
  }

  function isBillingPaused(sub: MemberSubscription) {
    return !!sub.pause_collection
  }

  function canFreeze(sub: MemberSubscription) {
    return (sub.status === 'active' || sub.status === 'trialing') && !isBillingPaused(sub)
  }

  /** Anything Stripe is still capable of charging for — a PAUSED subscription
   *  very much included, and past_due too: a card that keeps failing is exactly
   *  one a studio wants to stop retrying. Only an already-cancelled one is out. */
  function canCancel(sub: MemberSubscription) {
    return ['active', 'trialing', 'past_due', 'paused'].includes(sub.status as string)
  }

  // "Cancels on …" is a THIRD state, distinct from active and cancelled: the
  // member is still training and still has access, but this will not renew. The
  // date comes from the ONE shared predicate so this tab and the member's own
  // Space can never disagree about it.
  //
  // WHETHER IS ASKED SEPARATELY FROM WHEN, and the fallback line is the whole
  // point. A pre-migration member_subscriptions doc carries the cancellation
  // boolean and NO dates at all — the period had moved onto the subscription
  // item and the writer stored null — so keying the line on the date alone
  // rendered nothing whatsoever for that population: no date, and no
  // SubscriptionCancellationNote either (it has no `canceled_at` and no
  // `cancellation_details` to print, so it returns null too). A member winding
  // down looked identical to one renewing. This is the same gap that was closed
  // for the operator console, which says "at period end (date not recorded)"
  // rather than falling silent.
  function endsAtLabel(sub: MemberSubscription): string | null {
    const ms = subscriptionEndsAtMs(sub)
    if (ms !== null) return t('subCancelsOn', { date: new Date(ms).toLocaleDateString() })
    return subscriptionIsCancelling(sub) ? t('subCancelsAtPeriodEnd') : null
  }

  // ── STRIPE IS BILLING FOR SOMETHING NOBODY HAS ASSIGNED ────────────────────
  // The same comparison the contacts list and the attention queue run
  // (`contactBillingIsUnlinked`), asked here from what this section already
  // holds. It is raised where the button that fixes it is — the row's own
  // "Cancel billing" — rather than as a notification somewhere else.
  const liveSubs = recurringOnly.filter((s) =>
    ['active', 'trialing', 'past_due', 'paused'].includes(s.status as string)
  )
  const unlinked =
    assignedTypeId !== undefined &&
    liveSubs.length > 0 &&
    !liveSubs.some((s) => s.subscriptionTypeId === assignedTypeId)

  return (
    <>
      {unlinked && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">{t('billingUnlinkedTitle')}</p>
          <p className="mt-0.5">{t('billingUnlinkedBody')}</p>
        </div>
      )}
      <div className="rounded-lg border divide-y">
        {recurringOnly.map((sub) => {
          const paused = isBillingPaused(sub)
          const freezable = canFreeze(sub)
          const resumable = paused
          const cancellable = canCancel(sub)
          const endsAt = endsAtLabel(sub)

          return (
            <div key={sub.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {sub.subscriptionTypeName || formatMoneyMinor(sub.amount, sub.currency)}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {sub.subscriptionTypeName
                    ? formatMoneyMinor(sub.amount, sub.currency)
                    : sub.subscriptionId}
                </p>
                {endsAt && <p className="text-xs text-amber-600 truncate">{endsAt}</p>}
                {/* WHEN it was asked for and WHY — the record the boolean could not
                    carry. Shown for an ENDED subscription too (where there is no
                    "cancels on" line left): a studio reviewing a lapsed member
                    needs to know whether they walked or their card did. */}
                <SubscriptionCancellationNote subscription={sub} audience="studio" />
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
              {cancellable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setCancelTarget(sub.id)}
                  disabled={cancel.isPending}
                >
                  <Ban className="h-3.5 w-3.5 mr-1.5" />
                  {t('cancelBilling')}
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {/* Freeze confirm dialog */}
      <AlertDialog
        open={freezeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFreezeTarget(null)
        }}
      >
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

      {/* Cancel confirm dialog — its own, and its copy says what freezing's
          does not: this cannot be undone from here, and the member keeps their
          access until the period they have already paid for runs out. */}
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelBillingConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cancelBillingConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cancelTarget) {
                  cancel.mutate(cancelTarget)
                  setCancelTarget(null)
                }
              }}
              disabled={cancel.isPending}
            >
              {t('cancelBillingConfirmAction')}
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
  const [voidTarget, setVoidTarget] = useState<UnifiedPaymentRow | null>(null)
  const [refundTarget, setRefundTarget] = useState<UnifiedPaymentRow | null>(null)
  const { isInstalled } = useInstalledPlugins()
  const { data: journal } = useFinanceJournal(tid, null, isInstalled('finance'))
  const [recordOpen, setRecordOpen] = useState(false)

  // Determine whether Connect is in play: show subscriptions section only
  // when there's a teamId (subscriptions section guards internally via isLoading/empty).
  const showSubscriptions = !!tid

  const rollupStatus = contact.subscription_status as SubscriptionRollupStatus | undefined

  const rows = useMemo(
    () =>
      mergePaymentRows(connectToUnified(data?.payments ?? []), byoToUnified(data?.events ?? [])),
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
            assignedTypeId={contact.subscription_type_id ?? null}
            t={t}
          />
        </div>
      )}

      {/* ── Payment history ── */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('paymentsHeading')}
        </p>
        {tid && (
          <Button size="sm" variant="outline" onClick={() => setRecordOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t('recordButton')}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <CreditCard className="h-6 w-6 mx-auto mb-2 opacity-40" />
          {t('contactNoPayments')}
        </div>
      ) : (
        // Same table as the general /payments page, minus the (redundant)
        // contact column — one shared component so the two views never drift.
        //
        // WITH REFUND, since 2026-08-23. The component was already shared but
        // this mount left `onRefund` off, so the button simply did not render
        // here: a studio looking at the member whose charge they wanted to
        // reverse could see it and not act on it, and had to go and find the
        // same row again on /payments. Sharing a table is not sharing a
        // surface unless the actions come with it.
        <PaymentsTable
          rows={rows}
          // ALL TIME here, unlike the payments page: a contact's list is bounded
          // by one person's history, and windowing it would hide the very rows
          // somebody opened this tab to find.
          journal={journal}
          showContact={false}
          onAssign={setAssignTarget}
          onRefund={setRefundTarget}
          onVoid={setVoidTarget}
        />
      )}

      {tid && (
        <AssignPaymentDialog
          teamId={tid}
          target={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}

      {tid && (
        <RefundPaymentDialog
          teamId={tid}
          target={refundTarget}
          memberName={`${contact.firstname ?? ''} ${contact.lastname ?? ''}`.trim() || contact.email}
          onClose={() => setRefundTarget(null)}
        />
      )}

      {tid && (
        <VoidPaymentDialog
          teamId={tid}
          target={voidTarget}
          memberName={`${contact.firstname ?? ''} ${contact.lastname ?? ''}`.trim() || contact.email}
          onClose={() => setVoidTarget(null)}
        />
      )}

      {tid && (
        <RecordPaymentDialog
          teamId={tid}
          open={recordOpen}
          onClose={() => setRecordOpen(false)}
          contactId={contact.id}
        />
      )}
    </div>
  )
}
