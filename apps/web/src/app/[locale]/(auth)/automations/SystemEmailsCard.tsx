'use client'

// System emails — the automatic member-facing mail Linyup sends OUTSIDE the
// automations engine (booking confirmations, reminders, cancellation notices,
// data-update outcomes). Listed here so studios know they exist (and don't
// duplicate them with custom automations), with per-team on/off switches for
// studios that prefer full control. Enforcement lives in
// packages/functions/src/utils/systemEmails.ts (+ the pre-existing
// settings.bookingRemindersEnabled read in sendBookingReminders).
//
// Team-doc writes are owner-only per firestore.rules — managers see read-only.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { MailCheck } from 'lucide-react'

type ToggleKey =
  | 'booking_confirmation'
  | 'booking_reminder'
  | 'session_cancellation'
  | 'contact_update_review'

// Firestore field per key. booking_reminder reuses the pre-existing
// settings.bookingRemindersEnabled flag (already honoured by the daily task).
const FIELD_PATH: Record<ToggleKey, string> = {
  booking_confirmation: 'settings.system_emails.booking_confirmation',
  booking_reminder: 'settings.bookingRemindersEnabled',
  session_cancellation: 'settings.system_emails.session_cancellation',
  contact_update_review: 'settings.system_emails.contact_update_review',
}

const TOGGLE_KEYS: ToggleKey[] = [
  'booking_confirmation',
  'booking_reminder',
  'session_cancellation',
  'contact_update_review',
]

interface TeamEmailSettings {
  settings?: {
    system_emails?: Record<string, boolean>
    bookingRemindersEnabled?: boolean
  }
}

function readState(team: TeamEmailSettings | null | undefined): Record<ToggleKey, boolean> {
  const s = team?.settings
  return {
    booking_confirmation: s?.system_emails?.booking_confirmation !== false,
    booking_reminder: s?.bookingRemindersEnabled !== false,
    session_cancellation: s?.system_emails?.session_cancellation !== false,
    contact_update_review: s?.system_emails?.contact_update_review !== false,
  }
}

export function SystemEmailsCard() {
  const t = useTranslations('Automations')
  const { currentTeamId, team, teamRole } = useAuth()
  const canEdit = teamRole === 'owner'

  const [state, setState] = useState<Record<ToggleKey, boolean>>(() =>
    readState(team as TeamEmailSettings | null)
  )
  const [saving, setSaving] = useState<ToggleKey | null>(null)

  // Re-sync once the team doc (or a team switch) loads.
  const serialized = JSON.stringify(readState(team as TeamEmailSettings | null))
  useEffect(() => {
    setState(JSON.parse(serialized) as Record<ToggleKey, boolean>)
  }, [serialized])

  async function toggle(key: ToggleKey, value: boolean) {
    if (!currentTeamId || !canEdit) return
    setState((s) => ({ ...s, [key]: value })) // optimistic
    setSaving(key)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), { [FIELD_PATH[key]]: value })
    } catch {
      setState((s) => ({ ...s, [key]: !value })) // revert on failure
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <MailCheck className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">{t('systemEmails.title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('systemEmails.subtitle')}</p>
          {!canEdit && (
            <p className="text-xs text-muted-foreground mt-0.5">{t('systemEmails.ownerOnly')}</p>
          )}
        </div>
      </div>

      <div className="divide-y">
        {TOGGLE_KEYS.map((key) => (
          <div key={key} className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t(`systemEmails.${key}` as Parameters<typeof t>[0])}</p>
              <p className="text-xs text-muted-foreground">
                {t(`systemEmails.${key}Desc` as Parameters<typeof t>[0])}
              </p>
            </div>
            <Switch
              checked={state[key]}
              disabled={!canEdit || saving === key}
              onCheckedChange={(v) => toggle(key, v)}
            />
          </div>
        ))}

        {/* Always-on / configured-elsewhere entries — listed for awareness */}
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('systemEmails.otp')}</p>
            <p className="text-xs text-muted-foreground">{t('systemEmails.otpDesc')}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {t('systemEmails.alwaysOn')}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('systemEmails.formReceipt')}</p>
            <p className="text-xs text-muted-foreground">{t('systemEmails.formReceiptDesc')}</p>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {t('systemEmails.perForm')}
          </Badge>
        </div>
      </div>
    </div>
  )
}
