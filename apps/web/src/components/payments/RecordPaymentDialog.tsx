'use client'

// Record a manual cash / bank-transfer payment into the unified ledger. Amount +
// method + date + optional contact + structured line-item (drives entitlements) +
// note → recordManualPayment. Used from the Payments page and the contact tab.
//
// "SEND THE BUYER A RECEIPT" (UX-80) is the studio's per-sale choice, made here
// rather than in a settings page, because the argument against it — the money
// changed hands in front of somebody who already knows what they bought — is
// only answerable at the moment of the sale. It appears ONLY when the sale can
// actually be described (a pack, a membership, a course, a product — see
// `deskReceiptKindFor`) AND a contact is linked, and it starts ticked by what
// the sale GRANTS (`deskReceiptDefaultOn`). Changing "what was paid" re-picks
// that default until the manager overrides it, after which her choice stands.
//
// THE IDEMPOTENCY KEY is minted once per opening: without it every click of
// Record wrote a NEW payment row, so a double-click charged the ledger twice and
// would now mail twice as well.

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Plus, X } from 'lucide-react'
import { doc, updateDoc } from 'firebase/firestore'
import {
  DEFAULT_PAYMENT_MODES,
  TEAMS_COLLECTION,
  deskReceiptDefaultOn,
  deskReceiptKindFor,
  type PaymentLineItem,
} from '@linyup/shared'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useRecordManualPayment } from '@/hooks/useConnect'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A stable key for ONE recording attempt. `crypto.randomUUID` is not in every
 *  browser this app supports, so fall back rather than throw. */
function newAttemptKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function RecordPaymentDialog({
  teamId,
  open,
  onClose,
  contactId: presetContactId,
}: {
  teamId: string
  open: boolean
  onClose: () => void
  contactId?: string
}) {
  const t = useTranslations('PaymentsDashboard')
  const { team, teamRole } = useAuth()
  const currency = team?.default_currency ?? 'CHF'
  const record = useRecordManualPayment()
  // Only owners can write the team doc (Firestore rules), so gate the quick-add.
  const canAddMode = teamRole === 'owner'

  // Studio-configured payment modes; a sensible default set until they customize.
  const modes = useMemo(
    () =>
      team?.payment_modes && team.payment_modes.length > 0
        ? team.payment_modes
        : [...DEFAULT_PAYMENT_MODES],
    [team?.payment_modes]
  )

  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('')
  const [date, setDate] = useState(todayIso())
  const [contactId, setContactId] = useState(presetContactId ?? '')
  const [lineItem, setLineItem] = useState<PaymentLineItem | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sendReceipt, setSendReceipt] = useState(false)
  // Once the manager has answered the question herself, changing "what was paid"
  // must not silently un-answer it.
  const [receiptTouched, setReceiptTouched] = useState(false)
  const [attemptKey, setAttemptKey] = useState('')
  // Inline "add a payment mode" affordance state.
  const [addingMode, setAddingMode] = useState(false)
  const [newMode, setNewMode] = useState('')

  // Reset on each open.
  useEffect(() => {
    if (open) {
      setAmount('')
      setMode(modes[0] ?? '')
      setDate(todayIso())
      setContactId(presetContactId ?? '')
      setLineItem(null)
      setComment('')
      setError(null)
      setAddingMode(false)
      setNewMode('')
      setSendReceipt(false)
      setReceiptTouched(false)
      // One key per opening — every Record click in this dialog is the SAME
      // attempt, so the server writes one row and sends one receipt.
      setAttemptKey(newAttemptKey())
    }
    // modes is derived from team config; intentionally not a reset trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetContactId])

  // Persist a new payment mode onto the team (owner only) and select it. The team
  // doc is a live snapshot, so the Select picks up the new option immediately.
  async function addMode() {
    const v = newMode.trim().slice(0, 60)
    if (!v) {
      setAddingMode(false)
      return
    }
    if (!modes.some((m) => m.toLowerCase() === v.toLowerCase())) {
      await updateDoc(doc(db, TEAMS_COLLECTION, teamId), { payment_modes: [...modes, v] })
    }
    setMode(v)
    setNewMode('')
    setAddingMode(false)
  }

  // What the sale grants decides the default; the manager's own answer wins.
  const receiptKind = deskReceiptKindFor(lineItem)
  const canSendReceipt = !!contactId && !!receiptKind
  function pickLineItem(next: PaymentLineItem | null) {
    setLineItem(next)
    if (!receiptTouched) setSendReceipt(deskReceiptDefaultOn(next))
  }

  async function save() {
    const major = parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(major) || major <= 0) {
      setError(t('amountInvalid'))
      return
    }
    const minor = Math.round(major * 100)
    const occurredAt = date ? new Date(`${date}T12:00:00`).getTime() : undefined
    await record.mutateAsync({
      teamId,
      contactId: contactId || null,
      amount: minor,
      currency,
      occurredAt: Number.isFinite(occurredAt as number) ? occurredAt : undefined,
      paymentMode: mode.trim() || undefined,
      lineItem,
      comment: comment.trim() || null,
      idempotencyKey: attemptKey,
      // Never send for a sale the server would decline to describe, and never
      // for an unassigned row — there is nobody to send it to.
      sendReceipt: canSendReceipt && sendReceipt,
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('recordTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('amountLabel', { currency })}</Label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError(null)
                }}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dateLabel')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label>{t('methodLabel')}</Label>
            {addingMode ? (
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addMode()
                    }
                    if (e.key === 'Escape') {
                      setAddingMode(false)
                      setNewMode('')
                    }
                  }}
                  placeholder={t('methodPlaceholder')}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 px-2"
                  onClick={addMode}
                  disabled={!newMode.trim()}
                  aria-label={t('addModeLink')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 px-2"
                  onClick={() => {
                    setAddingMode(false)
                    setNewMode('')
                  }}
                  aria-label={t('cancel')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Select value={mode} onValueChange={(m) => m && setMode(m)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('methodPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {modes.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canAddMode && (
                  <button
                    type="button"
                    onClick={() => setAddingMode(true)}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" />
                    {t('addModeLink')}
                  </button>
                )}
              </>
            )}
          </div>

          <PaymentLineItemPicker teamId={teamId} value={lineItem} onChange={pickLineItem} />

          <div className="space-y-1.5">
            <Label>{t('assignContactLabel')}</Label>
            <ContactPicker teamId={teamId} value={contactId} onChange={setContactId} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('commentLabel')}</Label>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('commentPlaceholder')}
            />
          </div>

          {/* Shown only when there is something to describe AND somebody to
              send it to — an always-visible, always-disabled control would just
              be a question the studio cannot answer. */}
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
          <Button variant="outline" onClick={onClose} disabled={record.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={record.isPending}>
            {record.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('recordButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
