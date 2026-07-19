'use client'

// No-show policy (E5) — threshold-based fees, collected via an emailed payment
// link. Off by default. Persisted to teams/{id}.settings.noShowPolicy ONLY
// (never mirrored to public_profile — this is an internal studio policy, not a
// public booking setting). Owner-only team-doc write, same pattern as
// BookingInstructionsCard.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, resolveNoShowPolicy, type NoShowPolicySettings } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { AlertTriangle, Loader2 } from 'lucide-react'

const DEFAULT_THRESHOLD = 3

function getDefaults(settings: unknown): NoShowPolicySettings {
  const resolved = resolveNoShowPolicy(settings)
  if (resolved) return resolved
  return { enabled: false, feeAmount: 0, threshold: DEFAULT_THRESHOLD }
}

export function NoShowPolicyCard() {
  const t = useTranslations('SettingsBooking')
  const { currentTeamId, team, teamRole } = useAuth()
  const canEdit = teamRole === 'owner'
  const currency = team?.default_currency ?? 'CHF'

  const stored = getDefaults(team?.settings)
  const [enabled, setEnabled] = useState(stored.enabled)
  const [feeAmount, setFeeAmount] = useState(String(stored.feeAmount || ''))
  const [threshold, setThreshold] = useState(String(stored.threshold))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(stored.enabled)
    setFeeAmount(String(stored.feeAmount || ''))
    setThreshold(String(stored.threshold))
  }, [team?.id, stored.enabled, stored.feeAmount, stored.threshold])

  const feeAmountNumber = Number(feeAmount)
  const thresholdNumber = Math.floor(Number(threshold))
  const valid =
    !enabled || (Number.isFinite(feeAmountNumber) && feeAmountNumber > 0 && thresholdNumber >= 1)

  const dirty =
    enabled !== stored.enabled ||
    feeAmountNumber !== stored.feeAmount ||
    thresholdNumber !== stored.threshold

  async function save() {
    if (!currentTeamId || !canEdit || !valid) return
    setSaving(true)
    try {
      const policy: NoShowPolicySettings = {
        enabled,
        feeAmount: feeAmountNumber || 0,
        threshold: thresholdNumber || DEFAULT_THRESHOLD,
      }
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        'settings.noShowPolicy': policy,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t('noShowPolicyTitle')}</h2>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{t('noShowPolicySubtitle')}</p>
          {!canEdit && <p className="text-xs text-muted-foreground mt-0.5">{t('ownerOnly')}</p>}
        </div>
      </div>

      {enabled && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t('noShowFeeAmountLabel', { currency })}
            </label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={feeAmount}
              disabled={!canEdit}
              onChange={(e) => setFeeAmount(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('noShowThresholdLabel')}</label>
            <Input
              type="number"
              min={1}
              step="1"
              value={threshold}
              disabled={!canEdit}
              onChange={(e) => setThreshold(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">{t('noShowThresholdHint')}</p>
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!dirty || !valid || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  )
}
