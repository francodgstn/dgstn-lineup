'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { useTranslations } from 'next-intl'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCapabilities } from '@/hooks/useCapabilities'
import {
  TEAMS_COLLECTION,
  ROLE_CONFIG_SUBCOLLECTION,
  CAPABILITY_CATALOG,
  COACH_ASSIGNABLE_CAPABILITIES,
  COACH_DEFAULT_CAPABILITIES,
  TOGGLEABLE_COACH_ROLES,
  coachRolesFrom,
  capabilityIsScoped,
  type Capability,
  type TeamRole,
} from '@linyup/shared'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

// Owner/manager editor for the customizable Coach role's capability set. Writes
// teams/{id}/role_config/coach; the syncMemberCapabilities Cloud Function then
// recomputes every coach member's denormalized capabilities. System roles
// (owner/manager/viewer) are fixed and not shown here.

const ASSIGNABLE = new Set(COACH_ASSIGNABLE_CAPABILITIES)
const CATALOG = CAPABILITY_CATALOG.filter((c) => ASSIGNABLE.has(c.id))

export default function RolePermissionsPage() {
  const t = useTranslations('Roles')
  const tc = useTranslations('Capabilities')
  const { currentTeamId, user } = useAuth()
  const { can } = useCapabilities()
  const qc = useQueryClient()
  const canEdit = can('members.manage')

  const { data: stored, isLoading } = useQuery({
    queryKey: ['role-config', currentTeamId, 'coach'],
    enabled: !!currentTeamId,
    queryFn: async () => {
      const snap = await getDoc(
        doc(db, TEAMS_COLLECTION, currentTeamId!, ROLE_CONFIG_SUBCOLLECTION, 'coach'),
      )
      const d = snap.exists() ? snap.data() : null
      return {
        capabilities: (d?.capabilities as Capability[] | undefined) ?? null,
        coachRoles: (d?.coachRoles as TeamRole[] | undefined) ?? null,
      }
    },
  })

  const initial = useMemo<Set<Capability>>(
    () => new Set(stored?.capabilities ?? COACH_DEFAULT_CAPABILITIES),
    [stored],
  )
  const initialCoachRoles = useMemo<Set<TeamRole>>(
    () => new Set(coachRolesFrom(stored?.coachRoles)),
    [stored],
  )
  const [draft, setDraft] = useState<Set<Capability> | null>(null)
  const [coachRolesDraft, setCoachRolesDraft] = useState<Set<TeamRole> | null>(null)
  const selected = draft ?? initial
  const selectedCoachRoles = coachRolesDraft ?? initialCoachRoles
  const dirty = draft !== null || coachRolesDraft !== null
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function toggle(cap: Capability, on: boolean) {
    const next = new Set(draft ?? initial)
    if (on) next.add(cap)
    else next.delete(cap)
    setDraft(next)
    setSaved(false)
  }

  function toggleCoachRole(role: TeamRole, on: boolean) {
    const next = new Set(coachRolesDraft ?? initialCoachRoles)
    if (on) next.add(role)
    else next.delete(role)
    next.add('coach') // the Coach role is always a coach
    setCoachRolesDraft(next)
    setSaved(false)
  }

  async function save() {
    if (!currentTeamId) return
    setSaving(true)
    try {
      await setDoc(
        doc(db, TEAMS_COLLECTION, currentTeamId, ROLE_CONFIG_SUBCOLLECTION, 'coach'),
        {
          role: 'coach',
          capabilities: [...selected],
          coachRoles: [...selectedCoachRoles],
          updatedBy: user?.uid ?? null,
          updated_at: serverTimestamp(),
        },
        { merge: true },
      )
      await qc.invalidateQueries({ queryKey: ['role-config', currentTeamId, 'coach'] })
      await qc.invalidateQueries({ queryKey: ['team-coaches', currentTeamId] })
      setDraft(null)
      setCoachRolesDraft(null)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  // group catalogue by domain for display
  const byDomain = useMemo(() => {
    const m = new Map<string, typeof CATALOG>()
    for (const c of CATALOG) {
      const arr = m.get(c.domain) ?? []
      arr.push(c)
      m.set(c.domain, arr)
    }
    return [...m.entries()]
  }, [])

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('coachSubtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('coachEligibleTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('coachEligibleHint')}</p>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">{t('coachEligible_coach')}</Label>
            <Switch checked disabled />
          </div>
          {TOGGLEABLE_COACH_ROLES.map((r) => (
            <div key={r} className="flex items-center justify-between">
              <Label htmlFor={`iscoach-${r}`} className="text-sm font-normal">
                {t(`coachEligible_${r}` as 'coachEligible_owner' | 'coachEligible_manager')}
              </Label>
              <Switch
                id={`iscoach-${r}`}
                checked={selectedCoachRoles.has(r)}
                onCheckedChange={(v) => toggleCoachRole(r, v)}
                disabled={!canEdit}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>{t('coachRole')}</span>
            <span className="text-xs font-normal text-muted-foreground">{t('ownScopeNote')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : (
            byDomain.map(([domain, caps]) => (
              <div key={domain} className="space-y-2.5">
                {caps.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label htmlFor={c.id} className="text-sm font-medium">
                        {tc(c.labelKey)}
                      </Label>
                      {capabilityIsScoped(c.id) && (
                        <p className="text-xs text-muted-foreground">{t('scopedHint')}</p>
                      )}
                    </div>
                    <Switch
                      id={c.id}
                      checked={selected.has(c.id)}
                      onCheckedChange={(v) => toggle(c.id, v)}
                      disabled={!canEdit}
                    />
                  </div>
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? t('saving') : t('save')}
          </Button>
          {saved && <span className="text-sm text-muted-foreground">{t('saved')}</span>}
        </div>
      )}
    </div>
  )
}
