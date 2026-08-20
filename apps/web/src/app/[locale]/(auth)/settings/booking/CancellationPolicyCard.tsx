'use client'

// Team-wide cancellation policy default — shown on the public booking pages
// (before a visitor books) and appended to booking confirmation emails,
// whenever the activity being booked has no `cancellationPolicy` of its own.
// Per-activity overrides live in the activity editor.
//
// Deliberately separate from BookingInstructionsCard (settings/emails) — that
// field (bookingConfirmationInstructions) is email-only; this one is public,
// so it lives on the booking-flow settings page instead.
//
// Team-doc writes are owner-only per firestore.rules — managers see read-only.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { ShieldCheck, Loader2} from 'lucide-react'

interface TeamPolicySettings {
  settings?: { bookingCancellationPolicy?: string }
}

export function CancellationPolicyCard() {
  const t = useTranslations('SettingsBooking')
  const { currentTeamId, team, teamRole } = useAuth()
  const canEdit = teamRole === 'owner'

  const stored = (team as TeamPolicySettings | null)?.settings?.bookingCancellationPolicy ?? ''
  const [value, setValue] = useState(stored)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Re-sync once the team doc (or a team switch) loads.
  useEffect(() => {
    setValue(stored)
  }, [stored])

  async function save() {
    if (!currentTeamId || !canEdit) return
    setSaving(true)
    setSaved(false)
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        'settings.bookingCancellationPolicy': value.trim(),
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const dirty = value.trim() !== stored.trim()

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">{t('policyTitle')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('policySubtitle')}</p>
          {!canEdit && (
            <p className="text-xs text-muted-foreground mt-0.5">{t('policyOwnerOnly')}</p>
          )}
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setSaved(false)
        }}
        disabled={!canEdit}
        rows={5}
        maxLength={2000}
        placeholder={t('policyPlaceholder')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y disabled:opacity-60"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('policyHint')}</p>
        <div className="flex items-center gap-2 shrink-0">
          {saved && !dirty && (
            <span className="text-xs text-muted-foreground">{t('policySaved')}</span>
          )}
          <Button size="sm" onClick={save} disabled={!canEdit || saving || !dirty}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t('policySaving') : t('policySave')}
          </Button>
        </div>
      </div>
    </div>
  )
}
