'use client'

// Void a manual payment — "this record is wrong", not "the money came back".
//
// THE WHOLE DIALOG EXISTS TO KEEP THOSE TWO APART. A manager who mistypes CHF
// 1'800 for CHF 180 has no money to give back; she has a wrong row. So the copy
// never says "refund", the confirm says "Void", and the body states plainly that
// nothing moves — if cash really did change hands, giving it back is something
// she does at the till, and Linyup only records it.
//
// It is a one-way door with no undo, so it says so, and the reason field is
// there because "why is this row struck through" is asked months later by
// somebody who was not in the room.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useVoidManualPayment } from '@/hooks/useConnect'
import { formatMoneyMinor, paymentLabel, type UnifiedPaymentRow } from '@/lib/payments'
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

export function VoidPaymentDialog({
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
  const voidPayment = useVoidManualPayment()
  const [reason, setReason] = useState('')

  useEffect(() => {
    setReason('')
  }, [target?.key])

  if (!target) return null

  const who = memberName?.trim() || t('unassigned')
  const kind = target.lineItem?.kind
  // What else the void takes back. Hedged for the subscription case exactly as
  // the refund dialog is: the server clears the membership only if THIS payment
  // is the one that set it up, and the client cannot know whether a newer
  // payment has since taken ownership.
  const consequence =
    kind === 'subscription'
      ? t('voidReversesSubscription')
      : kind === 'course'
        ? t('voidReversesCourse', { name: who })
        : null

  async function submit() {
    if (!target) return
    try {
      await voidPayment.mutateAsync({
        teamId,
        paymentId: target.paymentId,
        reason: reason.trim() || null,
      })
      toast.success(t('voidSuccess'))
      onClose()
    } catch {
      // The reversal runs BEFORE the row is voided, so a failure here means
      // nothing changed at all — one message, and retrying is safe.
      toast.error(t('voidError'))
    }
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('voidTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('voidBody', {
              amount: formatMoneyMinor(target.amount, target.currency),
              label: paymentLabel(target),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <p className="-mt-2 text-sm text-muted-foreground">{t('voidNoMoney')}</p>
          {consequence && <p className="text-sm text-muted-foreground">{consequence}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">{t('voidReasonLabel')}</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('voidReasonPlaceholder')}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void submit()} disabled={voidPayment.isPending}>
            {voidPayment.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('voidConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
