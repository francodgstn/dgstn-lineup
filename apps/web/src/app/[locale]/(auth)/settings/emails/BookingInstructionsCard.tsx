'use client'

// Booking confirmation note — a studio-authored plain-text block appended to
// every booking confirmation email (group classes + appointments) as a highlighted
// "Important" box. Ideal for waivers, gear rules, arrival instructions.
// Per-activity overrides live in the activity editor; this is the team-wide
// default (teams/{id}.settings.bookingConfirmationInstructions).
//
// Team-doc writes are owner-only per firestore.rules — managers see read-only.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { ClipboardList } from 'lucide-react'

interface TeamInstructionSettings {
  settings?: { bookingConfirmationInstructions?: string }
}

export function BookingInstructionsCard() {
  const t = useTranslations('SettingsEmails')
  const { currentTeamId, team, teamRole } = useAuth()
  const canEdit = teamRole === 'owner'

  const stored =
    (team as TeamInstructionSettings | null)?.settings?.bookingConfirmationInstructions ?? ''
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
        'settings.bookingConfirmationInstructions': value.trim(),
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
        <ClipboardList className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">{t('instructionsTitle')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('instructionsSubtitle')}</p>
          {!canEdit && (
            <p className="text-xs text-muted-foreground mt-0.5">{t('instructionsOwnerOnly')}</p>
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
        rows={6}
        maxLength={2000}
        placeholder={t('instructionsPlaceholder')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y disabled:opacity-60"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('instructionsHint')}</p>
        <div className="flex items-center gap-2 shrink-0">
          {saved && !dirty && (
            <span className="text-xs text-muted-foreground">{t('instructionsSaved')}</span>
          )}
          <Button size="sm" onClick={save} disabled={!canEdit || saving || !dirty}>
            {saving ? t('instructionsSaving') : t('instructionsSave')}
          </Button>
        </div>
      </div>
    </div>
  )
}
