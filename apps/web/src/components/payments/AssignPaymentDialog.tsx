'use client'

// Shared "link a payment" dialog for a single payment, used by the general payments
// page and the per-contact Payments tab. A manager can set what was bought
// (line-item → drives entitlements), assign the contact, and edit a free-text note
// (with PAYMENT_COMMENT_PRESETS quick-picks). Both rails (Connect + BYO) flow
// through the one updatePaymentRecord callable.
//
// RE-ASSIGNING IS A MOVE, NOT A COPY, and the dialog says so before the manager
// commits: the callable takes the membership off the previous contact and gives
// it to the new one. Naming both people is the point — "This moves the
// membership from Ana to Ben" is checkable at a glance in a way that "Assign to
// Ben" is not, and picking the wrong Ben is the mistake this whole area exists
// to make recoverable.
//
// "SEND THE BUYER A RECEIPT" (UX-80) defaults differently here than on the
// record dialog, and the difference is the point. A FIRST assignment — an
// orphaned bank transfer finally linked to the member it belonged to — is the
// moment their pack becomes real, and they have been told nothing so far: it
// starts ticked, by what the sale grants. A MOVE is a correction of the
// studio's own record; the new holder usually already knows, and the old one
// was never told anything to retract. It starts unticked and is one click away.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import {
  PAYMENT_COMMENT_PRESETS,
  deskReceiptDefaultOn,
  deskReceiptKindFor,
  type PaymentLineItem,
} from '@linyup/shared'
import { useUpdatePaymentRecord } from '@/hooks/useConnect'
import { useActiveContacts } from '@/hooks/useActiveContacts'
import { ContactPicker, contactDisplayName } from '@/components/payments/ContactPicker'
import { PaymentLineItemPicker } from '@/components/payments/PaymentLineItemPicker'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface AssignPaymentTarget {
  source: 'connect' | 'byo'
  paymentId: string
  contactId: string | null
  comment: string | null
  lineItem?: PaymentLineItem | null
}

export function AssignPaymentDialog({
  teamId,
  target,
  onClose,
}: {
  teamId: string
  target: AssignPaymentTarget | null
  onClose: () => void
}) {
  const t = useTranslations('PaymentsDashboard')
  const tp = useTranslations('PaymentComment')
  const update = useUpdatePaymentRecord()
  // Same cached query the ContactPicker below already runs — resolving the two
  // names costs nothing extra.
  const { data: contacts = [] } = useActiveContacts(teamId)

  const [contactId, setContactId] = useState<string>(target?.contactId ?? '')
  const [comment, setComment] = useState<string>(target?.comment ?? '')
  const [lineItem, setLineItem] = useState<PaymentLineItem | null>(target?.lineItem ?? null)
  const [sendReceipt, setSendReceipt] = useState(false)
  const [receiptTouched, setReceiptTouched] = useState(false)

  // Re-seed local state whenever a new target is opened (parent passes a fresh
  // object each time), so the dialog always reflects the row being edited.
  useEffect(() => {
    if (target) {
      setContactId(target.contactId ?? '')
      setComment(target.comment ?? '')
      setLineItem(target.lineItem ?? null)
      // A row that already names somebody has already been through this dialog;
      // only a FIRST assignment starts ticked. See the header.
      setSendReceipt(!target.contactId && deskReceiptDefaultOn(target.lineItem ?? null))
      setReceiptTouched(false)
    }
  }, [target])

  async function save() {
    if (!target) return
    const vars: {
      teamId: string
      source: 'connect' | 'byo'
      paymentId: string
      contactId?: string | null
      comment?: string | null
      lineItem?: PaymentLineItem | null
      sendReceipt?: boolean
    } = { teamId, source: target.source, paymentId: target.paymentId }

    if (contactId !== (target.contactId ?? '')) vars.contactId = contactId || null
    if (comment.trim() !== (target.comment ?? '').trim()) vars.comment = comment.trim() || null
    if (JSON.stringify(lineItem) !== JSON.stringify(target.lineItem ?? null)) vars.lineItem = lineItem
    if (canSendReceipt && sendReceipt) vars.sendReceipt = true

    // Nothing changed — just close.
    if (vars.contactId === undefined && vars.comment === undefined && vars.lineItem === undefined) {
      onClose()
      return
    }
    try {
      await update.mutateAsync(vars)
    } catch {
      // The mutation's onError has already said what went wrong (a used pack, a
      // voided row, a half-finished move). Stay open on the manager's own input
      // so she can change the target rather than retype everything.
      return
    }
    onClose()
  }

  // WILL THIS SAVE ACTUALLY GRANT SOMETHING? Mirrors the server's `shouldApply`
  // in connect/updatePayment.ts, deliberately: the toggle must not offer a
  // receipt for a save that applies no effects, because the callable would then
  // accept the flag and correctly send nothing — a switch that silently does
  // nothing is worse than no switch.
  const contactChanged = contactId !== (target?.contactId ?? '')
  const lineItemChanged =
    JSON.stringify(lineItem) !== JSON.stringify(target?.lineItem ?? null)
  const receiptKind = deskReceiptKindFor(lineItem)
  const canSendReceipt = !!contactId && (contactChanged || lineItemChanged) && !!receiptKind

  function pickLineItem(next: PaymentLineItem | null) {
    setLineItem(next)
    if (!receiptTouched) setSendReceipt(!target?.contactId && deskReceiptDefaultOn(next))
  }

  // "This moves the membership from Ana to Ben." Shown only when the payment is
  // actually leaving somebody — and for an unassign, the shorter half of the
  // same sentence, because that reversal is just as invisible otherwise.
  const nameOf = (id: string) => {
    const c = contacts.find((x) => x.id === id)
    return c ? contactDisplayName(c) : null
  }
  const previousId = target?.contactId ?? ''
  const previousName = previousId ? nameOf(previousId) : null
  const nextName = contactId ? nameOf(contactId) : null
  const moving = !!target && !!previousId && contactId !== previousId
  const moveNote = !moving
    ? null
    : contactId
      ? t('reassignMoves', { from: previousName ?? t('unassigned'), to: nextName ?? t('unassigned') })
      : t('reassignRemoves', { from: previousName ?? t('unassigned') })

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('assignTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* What was bought (structured → drives entitlements) */}
          <PaymentLineItemPicker teamId={teamId} value={lineItem} onChange={pickLineItem} />

          {/* Contact */}
          <div className="space-y-1.5">
            <Label>{t('assignContactLabel')}</Label>
            <ContactPicker teamId={teamId} value={contactId} onChange={setContactId} />
            {/* Only when it MOVES: a first assignment takes nothing off anybody,
                and saying so there would be noise. */}
            {moveNote && <p className="text-xs text-muted-foreground">{moveNote}</p>}
          </div>

          {/* Free-text note with preset quick-picks */}
          <div className="space-y-1.5">
            <Label>{t('commentLabel')}</Label>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('commentPlaceholder')}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PAYMENT_COMMENT_PRESETS.map((preset) => {
                const label = tp(`preset_${preset}` as never)
                const active = comment.trim() === label
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setComment(label)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Only when this save grants something to somebody — see canSendReceipt. */}
          {canSendReceipt && (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t('sendReceiptLabel')}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`sendReceiptHint_${receiptKind}` as never)}
                </p>
              </div>
              <Switch
                checked={sendReceipt}
                onCheckedChange={(v) => {
                  setReceiptTouched(true)
                  setSendReceipt(v)
                }}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
