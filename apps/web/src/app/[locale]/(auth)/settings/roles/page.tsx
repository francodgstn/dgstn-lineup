'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { useTranslations } from 'next-intl'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCapabilities } from '@/hooks/useCapabilities'
import { usePlan } from '@/hooks/usePlan'
import { PlanUpgradeNotice } from '@/components/plan/PlanUpgradeNotice'
import {
  TEAMS_COLLECTION,
  ROLE_CONFIG_SUBCOLLECTION,
  CAPABILITY_CATALOG,
  COACH_ASSIGNABLE_CAPABILITIES,
  COACH_DEFAULT_CAPABILITIES,
  capabilityIsScoped,
  type Capability,
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
  const { isAtLeast } = usePlan()
  const qc = useQueryClient()
  // UX-42: this page had NO plan awareness at all — a complete, saveable Coach
  // permission editor on the Free plan, where a second user cannot exist, so
  // nobody can ever hold the role being configured. It stays visible (the
  // studio should be able to see what the role does before paying for it) and
  // says why it can't be used, which is the same gate the invite button uses.
  const planAllows = isAtLeast('coach')
  const canEdit = can('members.manage') && planAllows

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
      }
    },
  })

  const initial = useMemo<Set<Capability>>(
    () => new Set(stored?.capabilities ?? COACH_DEFAULT_CAPABILITIES),
    [stored],
  )
  const [draft, setDraft] = useState<Set<Capability> | null>(null)
  const selected = draft ?? initial
  const dirty = draft !== null
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function toggle(cap: Capability, on: boolean) {
    const next = new Set(draft ?? initial)
    if (on) next.add(cap)
    else next.delete(cap)
    setDraft(next)
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
          updatedBy: user?.uid ?? null,
          updated_at: serverTimestamp(),
        },
        { merge: true },
      )
      await qc.invalidateQueries({ queryKey: ['role-config', currentTeamId, 'coach'] })
      setDraft(null)
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

      <p className="text-xs text-muted-foreground">{t('coachAssignHint')}</p>

      {!planAllows && (
        <PlanUpgradeNotice
          minPlan="coach"
          variant="inline"
          title={t('planLockedTitle')}
          description={t('planLockedBody')}
        />
      )}

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
