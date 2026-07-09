'use client'

// Shared "link a payment" dialog for a single payment, used by the general payments
// page and the per-contact Payments tab. A manager can set what was bought
// (line-item → drives entitlements), assign the contact, and edit a free-text note
// (with PAYMENT_COMMENT_PRESETS quick-picks). Both rails (Connect + BYO) flow
// through the one updatePaymentRecord callable.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { PAYMENT_COMMENT_PRESETS, type PaymentLineItem } from '@linyup/shared'
import { useUpdatePaymentRecord } from '@/hooks/useConnect'
import { ContactPicker } from '@/components/payments/ContactPicker'
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

  const [contactId, setContactId] = useState<string>(target?.contactId ?? '')
  const [comment, setComment] = useState<string>(target?.comment ?? '')
  const [lineItem, setLineItem] = useState<PaymentLineItem | null>(target?.lineItem ?? null)

  // Re-seed local state whenever a new target is opened (parent passes a fresh
  // object each time), so the dialog always reflects the row being edited.
  useEffect(() => {
    if (target) {
      setContactId(target.contactId ?? '')
      setComment(target.comment ?? '')
      setLineItem(target.lineItem ?? null)
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
    } = { teamId, source: target.source, paymentId: target.paymentId }

    if (contactId !== (target.contactId ?? '')) vars.contactId = contactId || null
    if (comment.trim() !== (target.comment ?? '').trim()) vars.comment = comment.trim() || null
    if (JSON.stringify(lineItem) !== JSON.stringify(target.lineItem ?? null)) vars.lineItem = lineItem

    // Nothing changed — just close.
    if (vars.contactId === undefined && vars.comment === undefined && vars.lineItem === undefined) {
      onClose()
      return
    }
    await update.mutateAsync(vars)
    onClose()
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('assignTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* What was bought (structured → drives entitlements) */}
          <PaymentLineItemPicker teamId={teamId} value={lineItem} onChange={setLineItem} />

          {/* Contact */}
          <div className="space-y-1.5">
            <Label>{t('assignContactLabel')}</Label>
            <ContactPicker teamId={teamId} value={contactId} onChange={setContactId} />
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
