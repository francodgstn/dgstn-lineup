'use client'

// Refund a Connect payment — and, with it, the access the payment bought.
//
// The dialog exists in this shape because of ONE server refusal. Refunding a
// credit pack in full when the member has already taken three of the ten
// classes is not a thing the studio can simply be allowed to do (it would take
// back classes that were delivered) nor a thing it should simply be told "no"
// about. So `refundMemberPayment` answers `full_refund_on_consumed_pack` with
// the numbers, and the dialog turns them into three beats:
//
//   what is true  — "Ana has used 3 of the 10 classes on this pack"
//   why not       — "A full refund would take back classes she has taken"
//   what now      — "Refund pro-rata — CHF 126.00", or a different amount
//
// COMPUTED FOR HER, AND EDITABLE. Making a manager divide 180 by 10 and
// multiply by 7 under pressure is exactly the fat-finger failure this whole
// area is about. But locking the number is wrong the moment a cancellation fee
// or a goodwill gesture enters — and a "cancellation fee" IS just a smaller
// number typed here, which is why there is no separate feature for it. The
// default carries the arithmetic; the edit carries the judgement.
//
// The amount is only ever a SUGGESTION on the wire: the callable re-derives it
// and checks the manager's number against what is still refundable, never
// against the pro-rata figure.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRefundMemberPayment } from '@/hooks/useConnect'
import { formatMoneyMinor, type UnifiedPaymentRow } from '@/lib/payments'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

/** `details` of the `full_refund_on_consumed_pack` refusal. */
interface ConsumedPackSuggestion {
  unitsGranted: number
  unitsConsumed: number
  unitsRemaining: number
  proRataMinor: number
  maxRefundableMinor: number
}

function suggestionFrom(details: unknown): ConsumedPackSuggestion | null {
  const d = details as Partial<ConsumedPackSuggestion> | undefined
  if (!d || typeof d.unitsGranted !== 'number' || typeof d.proRataMinor !== 'number') return null
  return {
    unitsGranted: d.unitsGranted,
    unitsConsumed: d.unitsConsumed ?? 0,
    unitsRemaining: d.unitsRemaining ?? 0,
    proRataMinor: d.proRataMinor,
    maxRefundableMinor: d.maxRefundableMinor ?? 0,
  }
}

function minorFromMajorInput(text: string): number | null {
  const n = Number(text.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

export function RefundPaymentDialog({
  teamId,
  target,
  memberName,
  onClose,
}: {
  teamId: string
  target: UnifiedPaymentRow | null
  /** Display name of the contact the payment is assigned to, when known. */
  memberName?: string | null
  onClose: () => void
}) {
  const t = useTranslations('PaymentsDashboard')
  const refund = useRefundMemberPayment()

  const [suggestion, setSuggestion] = useState<ConsumedPackSuggestion | null>(null)
  const [editing, setEditing] = useState(false)
  const [amountText, setAmountText] = useState('')
  const [inlineError, setInlineError] = useState<string | null>(null)

  // Every open starts clean — a refusal from the previous row must not carry over.
  useEffect(() => {
    setSuggestion(null)
    setEditing(false)
    setAmountText('')
    setInlineError(null)
  }, [target?.key])

  if (!target) return null

  const currency = target.currency
  const maxRefundableMinor =
    suggestion?.maxRefundableMinor ?? Math.max(0, target.amount - target.amountRefunded)
  const who = memberName?.trim() || t('unassigned')

  const editedMinor = editing ? minorFromMajorInput(amountText) : null
  const amountInvalid =
    editing && (editedMinor === null || editedMinor > maxRefundableMinor)

  /** What the primary button will send: undefined = a full refund. */
  const submitMinor: number | undefined = editing
    ? (editedMinor ?? undefined)
    : suggestion
      ? suggestion.proRataMinor
      : undefined

  const primaryLabel = editing
    ? t('refundAmountAction', {
        amount: formatMoneyMinor(editedMinor ?? 0, currency),
      })
    : suggestion
      ? t('refundProRataAction', {
          amount: formatMoneyMinor(suggestion.proRataMinor, currency),
        })
      : t('refundAmountAction', { amount: formatMoneyMinor(target.amount, currency) })

  // A fully consumed pack has nothing to suggest — refunding CHF 0 is not an
  // offer, so the only route on is the editable amount.
  const proRataUnavailable = !!suggestion && suggestion.proRataMinor <= 0
  const primaryDisabled =
    refund.isPending || amountInvalid || (!editing && proRataUnavailable)

  function openEditor(prefillMinor: number) {
    setEditing(true)
    setInlineError(null)
    setAmountText((prefillMinor / 100).toFixed(2))
  }

  async function submit() {
    if (!target) return
    setInlineError(null)
    try {
      const res = await refund.mutateAsync({
        teamId,
        paymentIntentId: target.paymentId,
        ...(submitMinor !== undefined ? { amount: submitMinor } : {}),
      })
      // The money went back; the access did not. Not a failure of the refund —
      // but the studio has to finish the job by hand, so it must not be silent.
      if (res.reversal?.state === 'failed') {
        toast.warning(t('refundReversalFailed', { name: who }))
      } else {
        toast.success(t('refundSuccess'))
      }
      onClose()
    } catch (err) {
      const e = err as { details?: Record<string, unknown> }
      const reason = e?.details?.reason as string | undefined
      if (reason === 'full_refund_on_consumed_pack') {
        const s = suggestionFrom(e.details)
        if (s) {
          setSuggestion(s)
          setEditing(false)
          return
        }
      }
      if (reason === 'partial_refund_on_indivisible') {
        setInlineError(t('refundIndivisible'))
        return
      }
      toast.error(
        reason === 'gift_card_partially_redeemed'
          ? t('giftCardRefundPartlyRedeemed')
          : reason === 'gift_card_partial_refund_unsupported'
            ? t('giftCardRefundPartialUnsupported')
            : t('refundError')
      )
    }
  }

  // "What else this takes back", from the line item. Deliberately hedged for the
  // subscription case: the server clears the membership only if THIS payment is
  // the one that set it up, and the client cannot know whether a newer payment
  // has since taken ownership.
  const kind = target.lineItem?.kind
  const consequence =
    kind === 'subscription'
      ? t('refundReversesSubscription')
      : kind === 'course'
        ? t('refundReversesCourse', { name: who })
        : null

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {suggestion ? t('refundConsumedTitle') : t('refundConfirmTitle')}
          </AlertDialogTitle>
          {/* what is true */}
          <AlertDialogDescription>
            {suggestion
              ? t('refundConsumedWhat', {
                  name: who,
                  used: suggestion.unitsConsumed,
                  granted: suggestion.unitsGranted,
                })
              : t('refundConfirmBody', {
                  amount: formatMoneyMinor(target.amount, currency),
                })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* why not (refusal) / what else this takes back (confirm) */}
        {(suggestion || consequence) && (
          <p className="-mt-4 text-sm text-muted-foreground">
            {suggestion ? t('refundConsumedWhy') : consequence}
          </p>
        )}

        {/* what now */}
        <div className="space-y-2">
          {editing ? (
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">{t('refundAmountLabel')}</Label>
              <Input
                id="refund-amount"
                type="number"
                inputMode="decimal"
                step="0.05"
                min="0.01"
                max={(maxRefundableMinor / 100).toFixed(2)}
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
              <p className={`text-xs ${amountInvalid ? 'text-destructive' : 'text-muted-foreground'}`}>
                {t('refundAmountMax', {
                  amount: formatMoneyMinor(maxRefundableMinor, currency),
                })}
              </p>
              {/* The way back. Without it, a manager who tries a partial refund
                  on an indivisible sale and is refused has no route but Cancel. */}
              {!suggestion && (
                <button
                  type="button"
                  className="text-sm underline text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setEditing(false)
                    setInlineError(null)
                  }}
                >
                  {t('refundFullAmountInstead')}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="text-sm underline text-muted-foreground hover:text-foreground"
              onClick={() => openEditor(suggestion?.proRataMinor || maxRefundableMinor)}
            >
              {t('refundDifferentAmount')}
            </button>
          )}
          {inlineError && <p className="text-sm text-destructive">{inlineError}</p>}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          {/* Deliberately NOT an AlertDialogPrimitive.Close: a refusal has to be
              able to keep the dialog open and re-render it into its three beats. */}
          <AlertDialogAction onClick={() => void submit()} disabled={primaryDisabled}>
            {refund.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {primaryLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
