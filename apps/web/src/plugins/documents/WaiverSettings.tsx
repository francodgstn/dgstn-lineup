'use client'

// The waiver settings block on the document editor.
//
// ── THE MINORS CONTROL RENDERS INLINE, AND THAT IS A REQUIREMENT ───────────
// `mayIncludeMinors` is OFF by default, because the common case is an
// adults-only studio and every extra question on the acquisition path is a real
// conversion cost.
//
// The failure mode of that default is SILENT: a kids' club that never opens this
// setting collects adult-style signatures for minors, sees no chip on any
// roster, and nobody finds out until it matters. A FORCED CHOICE at creation was
// rejected, so the guard is VISIBILITY — this control sits inline in the editor,
// not behind an "advanced" disclosure and not collapsed, with one line stating
// exactly what turning it on does and what it does not. A studio may still
// choose wrong, but not without having read it.
//
// So: do not move this into a collapsible, do not move it to a second page, and
// do not reorder it below the fold. The reasoning is repeated on
// `WaiverConfig.mayIncludeMinors` in @linyup/shared, which is the other place
// its author will be standing.
//
// ── WHAT WRITES WHAT, BECAUSE IT IS ASYMMETRIC ─────────────────────────────
//   • mayIncludeMinors / validityMonths / scope → `updateWaiver` (ungated: a
//     downgraded studio must be able to narrow a scope or flag a waiver)
//   • `required`         → `setWaiverRequirement`, because that flag decides
//     whether the document appears in the team's waiver policy, and the flag may
//     only be written where the policy entry is patched in the SAME transaction.
//     `updateWaiver` refuses a `required` key outright rather than dropping it
//     silently — a silently-dropped field is how a studio comes to believe it
//     turned a gate off. (`archiveWaiver` clears the flag and the entry together,
//     which is the same rule, not an exception to it.)
//     Turning it ON is plan-gated; turning it OFF never is.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { WAIVER_MIN_PLAN, defaultWaiverConfig, type StudioDocument, type WaiverConfig } from '@linyup/shared'
import { usePlan } from '@/hooks/usePlan'
import { useActivities } from '@/hooks/useActivities'
import { setWaiverRequirement, updateWaiverSettings, waiverCallableError } from './hooks'

export function WaiverSettings({ document }: { document: StudioDocument }) {
  const t = useTranslations('Waivers')
  const qc = useQueryClient()
  const { isAtLeast } = usePlan()
  const canAuthor = isAtLeast(WAIVER_MIN_PLAN)
  const { data: activities = [] } = useActivities(document.teamId)

  const stored: WaiverConfig = document.waiver ?? defaultWaiverConfig()
  const [config, setConfig] = useState<WaiverConfig>(stored)
  useEffect(() => {
    setConfig(document.waiver ?? defaultWaiverConfig())
  }, [document.waiver])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['document', document.id] })
    qc.invalidateQueries({ queryKey: ['documents', document.teamId] })
  }

  const settingsMutation = useMutation({
    mutationFn: (patch: Partial<Pick<WaiverConfig, 'mayIncludeMinors' | 'validityMonths' | 'scope'>>) =>
      updateWaiverSettings(document.id, patch),
    onSuccess: () => {
      invalidate()
      toast.success(t('settingsSaved'))
    },
    onError: (err) => toast.error(waiverCallableError(err, t)),
  })

  const requiredMutation = useMutation({
    mutationFn: (required: boolean) => setWaiverRequirement(document.id, required),
    onSuccess: () => {
      invalidate()
      toast.success(t('settingsSaved'))
    },
    onError: (err) => {
      // Revert the optimistic switch: leaving it on after a refusal is how a
      // studio comes to believe its bookings are gated when they are not.
      setConfig((c) => ({ ...c, required: document.waiver?.required === true }))
      toast.error(waiverCallableError(err, t))
    },
  })

  const scopeMode = config.scope.appliesTo
  const scopedIds = config.scope.appliesTo === 'activities' ? config.scope.activityIds : []

  return (
    <div className="space-y-5 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('sectionTitle')}</h2>
      </div>

      {/* ── Participants may be minors. INLINE, never behind a disclosure —
          see the header. The hint states the CONSEQUENCE rather than the
          setting, and states both halves: what it adds, and what it is not. */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="waiver-minors">{t('minorsLabel')}</Label>
          <p className="text-xs text-muted-foreground">{t('minorsHint')}</p>
        </div>
        <Switch
          id="waiver-minors"
          checked={config.mayIncludeMinors === true}
          onCheckedChange={(value) => {
            setConfig((c) => ({ ...c, mayIncludeMinors: value }))
            settingsMutation.mutate({ mayIncludeMinors: value })
          }}
        />
      </div>

      {/* ── Where it applies ── */}
      <div className="space-y-2">
        <Label>{t('scopeLabel')}</Label>
        <Select
          value={scopeMode}
          onValueChange={(v) => {
            const scope: WaiverConfig['scope'] =
              v === 'all_bookings'
                ? { appliesTo: 'all_bookings' }
                : { appliesTo: 'activities', activityIds: scopedIds }
            setConfig((c) => ({ ...c, scope }))
            settingsMutation.mutate({ scope })
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all_bookings">{t('scopeAll')}</SelectItem>
            <SelectItem value="activities">{t('scopeActivities')}</SelectItem>
          </SelectContent>
        </Select>
        {scopeMode === 'activities' && (
          <div className="space-y-1.5 rounded-md border p-3">
            {activities.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('scopeNoActivities')}</p>
            )}
            {activities.map((a) => {
              const on = scopedIds.includes(a.id)
              return (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...scopedIds, a.id]
                        : scopedIds.filter((id) => id !== a.id)
                      const scope: WaiverConfig['scope'] = { appliesTo: 'activities', activityIds: ids }
                      setConfig((c) => ({ ...c, scope }))
                      settingsMutation.mutate({ scope })
                    }}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  {a.name}
                </label>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Validity ── */}
      <div className="space-y-1.5">
        <Label htmlFor="waiver-validity">{t('validityLabel')}</Label>
        <Input
          id="waiver-validity"
          type="number"
          min={0}
          className="max-w-[10rem]"
          value={config.validityMonths ?? ''}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              validityMonths: e.target.value === '' ? null : Number(e.target.value),
            }))
          }
          onBlur={() => settingsMutation.mutate({ validityMonths: config.validityMonths ?? null })}
        />
        {/* FUTURE SIGNATURES ONLY, and the studio is told so: the value in force
            at each tick is frozen onto that signature, so changing this number
            never re-dates one already taken. Saying otherwise would invite a
            studio to expect a population-wide effect it will not get. */}
        <p className="text-xs text-muted-foreground">{t('validityHint')}</p>
      </div>

      {/* ── The gate itself ── */}
      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div className="space-y-1">
          <Label htmlFor="waiver-required">{t('requiredLabel')}</Label>
          <p className="text-xs text-muted-foreground">
            {config.required ? t('requiredOnHint') : t('requiredOffHint')}
          </p>
          {!canAuthor && !config.required && (
            // Turning it ON is a creation-shaped act and is gated; turning it OFF
            // never is, so a downgraded studio is never left with a gate it
            // cannot lift. The copy says which half is unavailable.
            <p className="text-xs text-amber-600">{t('requiredPlanLocked')}</p>
          )}
        </div>
        <Switch
          id="waiver-required"
          checked={config.required}
          disabled={requiredMutation.isPending || (!canAuthor && !config.required)}
          onCheckedChange={(value) => {
            setConfig((c) => ({ ...c, required: value }))
            requiredMutation.mutate(value)
          }}
        />
      </div>
    </div>
  )
}
