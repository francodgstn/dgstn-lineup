'use client'

// SMS sender — the studio's alphanumeric sender name for transactional SMS
// (booking reminders). Stored at teams/{id}/integrations/sms_sender (owner-only
// per firestore.rules); consumed server-side by the SMS service, which falls
// back to "Linyup" when unset or disabled. SMS sending itself is billed from
// prepaid SMS credits on the platform's ESP account.

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  TEAMS_COLLECTION,
  TEAM_INTEGRATIONS_SUBCOLLECTION,
  SMS_SENDER_INTEGRATION_DOC,
} from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { MessageSquareText, Loader2} from 'lucide-react'

interface SmsSenderConfig {
  senderName?: string
  enabled?: boolean
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 11)
}

export function SmsSenderCard() {
  const t = useTranslations('SettingsEmails')
  const { currentTeamId, user, teamRole } = useAuth()
  const canEdit = teamRole === 'owner'
  const qc = useQueryClient()

  const { data: config } = useQuery<SmsSenderConfig | null>({
    queryKey: ['sms_sender', currentTeamId],
    // Integrations are owner-only readable; skip the query (and its permission
    // error) entirely for managers/coaches.
    enabled: !!currentTeamId && canEdit,
    queryFn: async () => {
      const snap = await getDoc(
        doc(
          db,
          TEAMS_COLLECTION,
          currentTeamId!,
          TEAM_INTEGRATIONS_SUBCOLLECTION,
          SMS_SENDER_INTEGRATION_DOC
        )
      )
      return snap.exists() ? (snap.data() as SmsSenderConfig) : null
    },
  })

  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(config?.senderName ?? '')
    setEnabled(config?.enabled ?? false)
  }, [config])

  const dirty = sanitize(name) !== (config?.senderName ?? '') || enabled !== (config?.enabled ?? false)

  async function save() {
    if (!currentTeamId || !canEdit) return
    setSaving(true)
    setSaved(false)
    try {
      await setDoc(
        doc(
          db,
          TEAMS_COLLECTION,
          currentTeamId,
          TEAM_INTEGRATIONS_SUBCOLLECTION,
          SMS_SENDER_INTEGRATION_DOC
        ),
        {
          type: 'sms_sender',
          senderName: sanitize(name),
          enabled,
          updated_at: serverTimestamp(),
          updatedBy: user?.uid ?? null,
        },
        { merge: true }
      )
      await qc.invalidateQueries({ queryKey: ['sms_sender', currentTeamId] })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  // Managers can't read or write the config — hide the card entirely.
  if (!canEdit) return null

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <MessageSquareText className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">{t('smsTitle')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('smsSubtitle')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="sms-sender-name">
            {t('smsSenderLabel')}
          </label>
          <Input
            id="sms-sender-name"
            value={name}
            onChange={(e) => {
              setName(sanitize(e.target.value))
              setSaved(false)
            }}
            placeholder="Linyup"
            maxLength={11}
            className="w-44"
          />
          <p className="text-xs text-muted-foreground">{t('smsSenderHelp')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer pb-6">
          <Switch
            checked={enabled}
            onCheckedChange={(v: boolean) => {
              setEnabled(v)
              setSaved(false)
            }}
          />
          {t('smsEnabledLabel')}
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('smsCostNote')}</p>
        <div className="flex items-center gap-2 shrink-0">
          {saved && !dirty && <span className="text-xs text-muted-foreground">{t('instructionsSaved')}</span>}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t('instructionsSaving') : t('instructionsSave')}
          </Button>
        </div>
      </div>
    </div>
  )
}
