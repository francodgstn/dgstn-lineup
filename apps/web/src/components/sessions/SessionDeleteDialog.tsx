'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { deleteDoc, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { toast } from 'sonner'
import { db, functions } from '@/lib/firebase'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SESSIONS_COLLECTION } from '@linyup/shared'
import type { Session } from '@linyup/shared'
import { Loader2, Repeat2, AlertTriangle } from 'lucide-react'

/**
 * Series-aware session delete. Standalone sessions are removed directly; sessions
 * that belong to a recurring series offer a "this only / this and following"
 * choice and go through the `cancelSession` Cloud Function (which also notifies
 * booked contacts and marks single deletions as cancelled exceptions).
 *
 * ONE EXCEPTION, and it is about money: an appointment hold created with a
 * Stripe PAYMENT LINK carries `payment_checkout_session_id`, and that id is the
 * only thing that can ever close a link which stays payable for seven days.
 * Deleting the document throws it away. So those go through
 * `cancelAppointmentSlot` first — it closes the link, then cancels — and the
 * delete follows. A delete on its own is not the defect decision 16 describes (a
 * late payment for a MISSING session is refunded by handleAppointmentCheckout,
 * not re-acquired); losing the ability to close the link is.
 */
export function SessionDeleteDialog({
  open, onOpenChange, session, label, onDeleted,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  session: Session | null
  label: string
  onDeleted: () => void
}) {
  const t = useTranslations('Sessions')
  const isSeries = !!session?.seriesId

  const [scope, setScope] = useState<'single' | 'future'>('single')
  const [busy, setBusy] = useState(false)

  function close() {
    setScope('single')
    setBusy(false)
    onOpenChange(false)
  }

  async function confirm() {
    if (!session) return
    setBusy(true)
    try {
      if (isSeries) {
        const cancel = httpsCallable<{ sessionId: string; deleteScope: string }, unknown>(functions, 'cancelSession')
        await cancel({ sessionId: session.id, deleteScope: scope })
      } else {
        if (session.activityType === 'appointment' && session.payment_checkout_session_id) {
          const closeLink = httpsCallable<
            { teamId: string; sessionId: string },
            { ok: boolean; cancelled: boolean; reason?: string; linkStillOpen?: boolean }
          >(functions, 'cancelAppointmentSlot')
          const res = await closeLink({ teamId: session.teamId, sessionId: session.id })
          if (res.data?.ok === false) {
            // The client paid in the window. Do NOT delete: the appointment is
            // paid for, and deleting it here would erase the only record of it.
            toast.warning(t('deleteAppointmentPaidInWindow'), { duration: 10_000 })
            setBusy(false)
            return
          }
          if (res.data?.linkStillOpen) {
            toast.warning(t('deleteAppointmentLinkStillOpen'), { duration: 10_000 })
          }
        }
        await deleteDoc(doc(db, SESSIONS_COLLECTION, session.id))
      }
      onDeleted()
      close()
    } catch {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSeries
              ? <><Repeat2 className="h-4 w-4 text-primary" />{t('deleteScopeTitle')}</>
              : <><AlertTriangle className="h-4 w-4 text-destructive" />{t('deleteSessionTitle')}</>}
          </DialogTitle>
        </DialogHeader>

        {isSeries ? (
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">{t('deleteScopeDescription')}</p>
            <div className="space-y-2">
              {(['single', 'future'] as const).map(s => (
                <label key={s}
                  className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    scope === s ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50'
                  }`}>
                  <input type="radio" name="deleteScope" checked={scope === s}
                    onChange={() => setScope(s)} className="accent-primary" />
                  <span className="text-sm">{s === 'single' ? t('deleteScopeThis') : t('deleteScopeFuture')}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground pt-1">{t('deleteConfirm', { label })}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={close} disabled={busy}
            className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
            {t('cancel')}
          </button>
          <button type="button" onClick={confirm} disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-white text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('delete')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
