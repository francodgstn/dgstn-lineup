'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { CONTACTS_COLLECTION, type Contact } from '@linyup/shared'
import { useCapabilities } from '@/hooks/useCapabilities'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

// Multi-coach assignment for a contact. Owners/managers (members.manage) pick one or
// more coaches; a coach-role member then sees the contact in their own book (own
// scope keys off assigned_coach_ids). Eligible coaches = team members flagged as
// coaches (per-member is_coach; absent ⇒ coach — toggled per user in Settings → Team).
// Writes assigned_coach_ids directly, independent of the profile form.
export function CoachAssignment({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const { can } = useCapabilities()
  const qc = useQueryClient()
  const canEdit = !!teamId && can('members.manage')

  const { data: coaches = [] } = useQuery({
    queryKey: ['team-coaches-roster', teamId],
    enabled: canEdit,
    queryFn: async () => {
      // Member display names live on users/{uid}, which Firestore rules deny reading
      // cross-user client-side — so the roster comes from the listTeamMembers callable
      // (same source as useCoaches / the /coaches page). Coach roster = members flagged
      // as coaches (per-member is_coach; absent ⇒ coach).
      const res = await httpsCallable(functions, 'listTeamMembers')({ teamId })
      const members =
        (res.data as {
          members?: Array<{
            userId: string
            displayName: string | null
            email: string | null
            isCoach: boolean
          }>
        }).members ?? []
      return members
        .filter((m) => m.isCoach)
        .map((m) => ({ uid: m.userId, name: m.displayName || m.email || m.userId }))
    },
  })

  const [assigned, setAssigned] = useState<Set<string>>(
    () => new Set(contact.assigned_coach_ids ?? []),
  )
  const [saving, setSaving] = useState<string | null>(null)

  if (!canEdit) return null

  async function toggle(uid: string, on: boolean) {
    if (!teamId) return
    const next = new Set(assigned)
    if (on) next.add(uid)
    else next.delete(uid)
    setAssigned(next) // optimistic
    setSaving(uid)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
        assigned_coach_ids: on ? arrayUnion(uid) : arrayRemove(uid),
      })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">{t('coachesTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('coachesHint')}</p>
      </div>
      {coaches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('coachesNone')}</p>
      ) : (
        <div className="space-y-2">
          {coaches.map((c) => (
            <div key={c.uid} className="flex items-center justify-between gap-4">
              <Label htmlFor={`coach-${c.uid}`} className="text-sm font-normal">
                {c.name}
              </Label>
              <Switch
                id={`coach-${c.uid}`}
                checked={assigned.has(c.uid)}
                disabled={saving === c.uid}
                onCheckedChange={(v) => toggle(c.uid, v)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
