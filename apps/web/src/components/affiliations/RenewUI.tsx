'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FloatingSlot } from '@/components/layout/FloatingDock'

// Shared, namespace-agnostic UI for the renew action (used by the contact detail
// tab and the team + org rosters). All copy is passed in so each surface keeps its
// own i18n namespace.

/** Floating action bar for bulk-renewing selected affiliations — mirrors the
 *  contacts page BulkBar pill. */
export function AffiliationBulkBar({
  selectedLabel,
  renewLabel,
  clearLabel,
  onRenew,
  onClear,
  busy,
}: {
  selectedLabel: string
  renewLabel: string
  clearLabel: string
  onRenew: () => void
  onClear: () => void
  busy?: boolean
}) {
  return (
    <FloatingSlot lane="page-bar">
      <div className="flex items-center gap-2 bg-card border rounded-full shadow-lg px-4 py-2">
        <span className="text-sm font-medium mr-2">{selectedLabel}</span>
        <button
          onClick={onRenew}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {renewLabel}
        </button>
        <button
          onClick={onClear}
          className="p-1.5 rounded-full hover:bg-muted transition-colors ml-0.5 text-muted-foreground"
          aria-label={clearLabel}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </FloatingSlot>
  )
}

/** Confirmation dialog for a renew (single or bulk). If `feeCheckboxLabel` is set,
 *  shows an optional "issuer fee received" checkbox whose value is passed to onConfirm. */
export function RenewConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  feeCheckboxLabel,
  onConfirm,
  busy,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  feeCheckboxLabel?: string | null
  onConfirm: (feePaid: boolean) => void
  busy?: boolean
}) {
  const [feePaid, setFeePaid] = useState(false)
  useEffect(() => {
    if (open) setFeePaid(false)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {feeCheckboxLabel && (
          <label className="flex items-center gap-2 text-sm cursor-pointer py-1">
            <input
              type="checkbox"
              checked={feePaid}
              onChange={(e) => setFeePaid(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            {feeCheckboxLabel}
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button onClick={() => onConfirm(feePaid)} disabled={busy}>
            {busy ? '…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
