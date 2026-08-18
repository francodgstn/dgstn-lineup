'use client'

// Experimental features — the studio's opt-in for work that is built and
// working but not yet settled. The list comes from the ONE registry
// (packages/shared/src/types/experimental.ts); adding the next experiment is an
// entry there plus the read at its own surface, and this page needs no edit.
//
// Deliberately NOT a plugin: an install spends a slot under `pluginInstallLimit`
// and an experiment is not worth a Coach's single explore slot (UX-39).
//
// Team-doc writes are owner-only per firestore.rules
// (`allow update: if hasTeamRole(teamId, 'owner') && paymentsUnchanged()`), so a
// manager who deep-links here gets the list read-only with the reason stated.
// The rail hides the row for her (`gate: 'ownerOnly'`) — that is navigation,
// never enforcement.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TEAMS_COLLECTION, type ExperimentalFeatureId } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { useExperimentalFeatures } from '@/hooks/useExperimentalFeatures'
import { usePlan } from '@/hooks/usePlan'
import { usePlanName } from '@/hooks/usePlanName'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { FlaskConical } from 'lucide-react'

export default function ExperimentalSettingsPage() {
  const t = useTranslations('SettingsExperimental')
  const { currentTeamId, teamRole } = useAuth()
  const { features, enabled, isLoading } = useExperimentalFeatures()
  // A tier note, never a tier gate: an experiment is not sold, so the switch
  // stays live below the tier and only says where the surface will appear.
  const { isAtLeast } = usePlan()
  const planName = usePlanName()
  const canEdit = teamRole === 'owner'
  const [pending, setPending] = useState<ExperimentalFeatureId | null>(null)

  // The whole map is written at once, never a per-key dotted path: a feature id
  // is kebab-case and a hyphen is not legal in an unquoted Firestore field path.
  // Rebuilding from `enabled` (already normalised) also drops any stale id a
  // withdrawn experiment left behind.
  async function toggle(id: ExperimentalFeatureId, next: boolean) {
    if (!currentTeamId || !canEdit) return
    setPending(id)
    const map: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(enabled)) if (value) map[key] = true
    if (next) map[id] = true
    else delete map[id]
    try {
      await updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        'settings.experimentalFeatures': map,
      })
      // No local state to reconcile — AuthContext holds the team doc on an
      // onSnapshot, so the switch and the consuming surface both follow the write.
      toast.success(next ? t('toastEnabled') : t('toastDisabled'))
    } catch (err) {
      console.error('[experimental toggle] failed:', err)
      toast.error(err instanceof Error ? err.message : t('toastFailed'))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('pageSubtitle')}</p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* What "experimental" means here, said plainly and once. Nothing below
            repeats it — a warning printed on every row stops being read. */}
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed bg-muted/30 p-4">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t('meaningTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('meaningBody')}</p>
          </div>
        </div>

        {!canEdit && <p className="text-xs text-muted-foreground">{t('ownerOnly')}</p>}

        {isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : features.length === 0 ? (
          // Reachable: the list empties whenever the last experiment graduates
          // into a real feature or is withdrawn.
          <div className="rounded-xl border bg-card p-6 text-center">
            <p className="text-sm font-medium">{t('emptyTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('emptyBody')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {features.map((feature) => {
              const on = enabled[feature.id] === true
              return (
                <div key={feature.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-sm font-medium">
                        {t(feature.nameKey as Parameters<typeof t>[0])}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {t(feature.descriptionKey as Parameters<typeof t>[0])}
                      </p>
                      <p className="text-xs text-muted-foreground/80">
                        {t('whereLabel')}{' '}
                        {t(feature.surfaceKey as Parameters<typeof t>[0])}
                        {feature.minPlan && !isAtLeast(feature.minPlan) && (
                          <>
                            {' '}
                            {t('planNote', { plan: planName(feature.minPlan) })}
                          </>
                        )}
                      </p>
                    </div>
                    <Switch
                      checked={on}
                      disabled={!canEdit || pending === feature.id}
                      onCheckedChange={(checked: boolean) => toggle(feature.id, checked)}
                      aria-label={t(feature.nameKey as Parameters<typeof t>[0])}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
