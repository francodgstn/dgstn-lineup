'use client'

// Shared "assign contact + edit comment" dialog for a single payment, used by the
// general payments page and the per-contact Payments tab. The contact picker
// searches by name/email; the comment field is free-text with predefined preset
// suggestions (PAYMENT_COMMENT_PRESETS) shown as quick-pick chips. Both rails
// (Connect + BYO) flow through the one updatePaymentRecord callable.

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2, Search, UserX } from 'lucide-react'
import { PAYMENT_COMMENT_PRESETS } from '@linyup/shared'
import { useActiveContacts } from '@/hooks/useActiveContacts'
import { useUpdatePaymentRecord } from '@/hooks/useConnect'
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
}

function contactName(c: { firstname?: string; lastname?: string; email?: string; id: string }): string {
  const name = `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim()
  return name || c.email || c.id
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
  const { data: contacts = [] } = useActiveContacts(teamId)
  const update = useUpdatePaymentRecord()

  const [contactId, setContactId] = useState<string>(target?.contactId ?? '')
  const [comment, setComment] = useState<string>(target?.comment ?? '')
  const [search, setSearch] = useState('')

  // Re-seed local state whenever a new target is opened (parent passes a fresh
  // object each time), so the dialog always reflects the row being edited.
  useEffect(() => {
    if (target) {
      setContactId(target.contactId ?? '')
      setComment(target.comment ?? '')
      setSearch('')
    }
  }, [target])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? contacts.filter((c) =>
          `${contactName(c)} ${c.email ?? ''}`.toLowerCase().includes(q)
        )
      : contacts
    return list.slice(0, 50)
  }, [contacts, search])

  const selectedContact = contacts.find((c) => c.id === contactId)

  async function save() {
    if (!target) return
    const vars: {
      teamId: string
      source: 'connect' | 'byo'
      paymentId: string
      contactId?: string | null
      comment?: string | null
    } = { teamId, source: target.source, paymentId: target.paymentId }

    if (contactId !== (target.contactId ?? '')) vars.contactId = contactId || null
    if (comment.trim() !== (target.comment ?? '').trim()) vars.comment = comment.trim() || null

    // Nothing changed — just close.
    if (vars.contactId === undefined && vars.comment === undefined) {
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
          {/* Comment with preset quick-picks */}
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

          {/* Contact picker */}
          <div className="space-y-1.5">
            <Label>{t('assignContactLabel')}</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('assignSearchPlaceholder')}
                className="pl-8"
              />
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border divide-y">
              {/* Unassign option */}
              <button
                type="button"
                onClick={() => setContactId('')}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                  contactId === '' && 'bg-muted'
                )}
              >
                <UserX className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{t('assignUnassigned')}</span>
                {contactId === '' && <Check className="h-4 w-4 text-primary" />}
              </button>
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setContactId(c.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                    contactId === c.id && 'bg-muted'
                  )}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{contactName(c)}</span>
                    {c.email && (
                      <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                    )}
                  </span>
                  {contactId === c.id && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {t('assignNoContacts')}
                </p>
              )}
            </div>
            {selectedContact && (
              <p className="text-xs text-muted-foreground">
                {t('assignSelected', { name: contactName(selectedContact) })}
              </p>
            )}
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
