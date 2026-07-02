'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  CONTACTS_COLLECTION,
  TEAMS_COLLECTION,
  ROLE_CONFIG_SUBCOLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  coachRolesFrom,
  type Contact,
  type TeamRole,
} from '@linyup/shared'
import { useCapabilities } from '@/hooks/useCapabilities'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

// Multi-coach assignment for a contact. Owners/managers (members.manage) pick one or
// more coaches; a coach-role member then sees the contact in their own book (own
// scope keys off assigned_coach_ids). Eligible coaches = team members whose role is in
// the team's coachRoles config (Coach always, owner/manager opt-in — Settings → Roles).
// Writes assigned_coach_ids directly, independent of the profile form.
export function CoachAssignment({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const { can } = useCapabilities()
  const qc = useQueryClient()
  const canEdit = !!teamId && can('members.manage')

  const { data: coaches = [] } = useQuery({
    queryKey: ['team-coaches', teamId],
    enabled: canEdit,
    queryFn: async () => {
      const cfg = await getDoc(
        doc(db, TEAMS_COLLECTION, teamId!, ROLE_CONFIG_SUBCOLLECTION, 'coach'),
      )
      const roles = coachRolesFrom(
        cfg.exists() ? (cfg.data()?.coachRoles as TeamRole[] | undefined) : undefined,
      )
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId!, TEAM_MEMBERS_SUBCOLLECTION),
      )
      const eligible = snap.docs.filter((d) => roles.includes(d.data()?.role as TeamRole))
      return Promise.all(
        eligible.map(async (d) => {
          const u = await getDoc(doc(db, 'users', d.id))
          const name = u.exists()
            ? (u.data()?.displayName as string) || (u.data()?.email as string)
            : (d.data()?.email as string) || d.id
          return { uid: d.id, name }
        }),
      )
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
