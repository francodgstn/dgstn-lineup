'use client'

// Record a manual cash / bank-transfer payment into the unified ledger. Amount +
// method + date + optional contact + structured line-item (drives entitlements) +
// note → recordManualPayment. Used from the Payments page and the contact tab.

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Plus, X } from 'lucide-react'
import { doc, updateDoc } from 'firebase/firestore'
import { DEFAULT_PAYMENT_MODES, TEAMS_COLLECTION, type PaymentLineItem } from '@linyup/shared'
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

          <PaymentLineItemPicker teamId={teamId} value={lineItem} onChange={setLineItem} />

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
