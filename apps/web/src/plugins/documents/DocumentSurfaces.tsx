'use client'

// "Where documents are asked for" — the ONE place a studio can see, and compare,
// the two things it can do with a published document.
//
// ── WHY THIS PANEL EXISTS ───────────────────────────────────────────────────
// There are two consent mechanisms and they are NOT peers. Before this panel,
// one lived behind a button on this list ("Signup consent", a dialog) and the
// other lived on ONE document's detail page, rendered only for `kind: 'waiver'`.
// Nothing put them side by side, and nothing anywhere said which of them refuses
// a booking. So a studio that wrote its house rules, published them as a
// `regulation` and attached them to signup believed its bookings were gated.
// They were not, and no screen said so.
//
//   • Shown at signup       → `teams/{id}/settings/documents.signupDocumentIds`
//                             mirrored to `TeamPublicProfile.signup_documents`,
//                             read by the signup form and NOTHING else.
//                             THIS RAIL RECORDS; IT NEVER REFUSES — the sentence
//                             is `packages/functions/src/waivers/signup.ts`'s
//                             own: "Signup is not attendance."
//   • Required before booking → `teams/{id}/waiver_policy/current` via
//                             `setWaiverRequirement`, read by `enforceWaiverGate`
//                             on every rail that puts a person in a room. Every
//                             one of those rails REFUSES.
//
// That difference is the panel's first line of copy, not a footnote. The two
// mechanisms are deliberately kept as they are — this is a surface merge, not a
// data migration.
//
// ── A NON-WAIVER ROW IS DISABLED IN PLACE, NEVER HIDDEN ─────────────────────
// Only a waiver can carry a requirement (`waiverPolicyEntryFor` returns null for
// every other kind). Hiding the second column for a `regulation` is exactly what
// made the limitation invisible: a manager authoring "House Rules" reaches for
// `Regulation`, not the legally-loaded word, and then sees nothing missing. So
// the control is rendered, disabled, WITH the reason and the remedy beside it.
//
// ── THE PLAN LOCK GOES THROUGH PlanGate ─────────────────────────────────────
// Requiring a waiver is Studio-gated (`WAIVER_MIN_PLAN`). The lock is PlanGate's
// own prompt, shown once below the list — not a bespoke card. Turning a
// requirement OFF is never gated, which is the same asymmetry `WaiverSettings`
// and `setWaiverRequirement` carry: a downgraded studio must always be able to
// lift a gate it can no longer create.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClipboardCheck, FileText } from 'lucide-react'
import { WAIVER_MIN_PLAN } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { PlanGate } from '@/components/plan/PlanGate'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  useDocuments,
  useSignupDocumentIds,
  saveSignupDocumentIds,
  setWaiverRequirement,
  waiverCallableError,
} from '@/plugins/documents/hooks'

export function DocumentSurfaces() {
  const t = useTranslations('Documents')
  const tWaivers = useTranslations('Waivers')
  const { currentTeamId } = useAuth()
  const qc = useQueryClient()
  const { isAtLeast } = usePlan()
  const canRequire = isAtLeast(WAIVER_MIN_PLAN)

  const { data: documents = [], isLoading } = useDocuments(currentTeamId)
  const { data: savedIds, isLoading: idsLoading } = useSignupDocumentIds(currentTeamId)

  const published = documents.filter((d) => d.status === 'published')

  // Signup selection: optimistic locally, re-synced whenever the persisted list
  // changes underneath us (a successful save invalidates the settings query).
  const [signupIds, setSignupIds] = useState<string[]>([])
  useEffect(() => {
    if (savedIds) setSignupIds(savedIds)
  }, [savedIds])

  // Requirement: the switch reads `document.waiver.required` — the same field
  // `WaiverSettings` drives, so the two controls can never disagree — with a
  // local override per document so a toggle doesn't wait for the round trip.
  const [requiredOverride, setRequiredOverride] = useState<Record<string, boolean>>({})

  const signupMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentTeamId) throw new Error('Not authenticated')
      await saveSignupDocumentIds(currentTeamId, ids)
    },
    onSuccess: () => {
      toast.success(t('saved'))
      qc.invalidateQueries({ queryKey: ['documents-settings', currentTeamId] })
    },
    onError: () => {
      // Put the switch back. Leaving it on after a failed write is how a studio
      // comes to believe it is collecting a consent it is not.
      setSignupIds(savedIds ?? [])
      toast.error(t('surfacesSignupError'))
    },
  })

  const requiredMutation = useMutation({
    mutationFn: ({ documentId, required }: { documentId: string; required: boolean }) =>
      setWaiverRequirement(documentId, required),
    onSuccess: () => {
      toast.success(t('saved'))
      qc.invalidateQueries({ queryKey: ['documents', currentTeamId] })
    },
    onError: (err, variables) => {
      setRequiredOverride((prev) => {
        const next = { ...prev }
        delete next[variables.documentId]
        return next
      })
      toast.error(waiverCallableError(err, tWaivers))
    },
  })

  if (isLoading || idsLoading) return <Skeleton className="h-40 w-full rounded-xl" />

  const toggleSignup = (documentId: string) => {
    const next = signupIds.includes(documentId)
      ? signupIds.filter((x) => x !== documentId)
      : [...signupIds, documentId]
    setSignupIds(next)
    signupMutation.mutate(next)
  }

  const toggleRequired = (documentId: string, required: boolean) => {
    setRequiredOverride((prev) => ({ ...prev, [documentId]: required }))
    requiredMutation.mutate({ documentId, required })
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          {t('surfacesTitle')}
        </h2>
        {/* THE SENTENCE. Which column records, which column refuses. */}
        <p className="mt-1 text-sm text-muted-foreground">{t('surfacesExplainer')}</p>
      </div>

      {published.length === 0 ? (
        <div className="p-8 text-center">
          <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t('surfacesEmpty')}</p>
        </div>
      ) : (
        <>
          {/* Column headers — sm+ only. Each row carries its own labels on
              mobile, so the two columns are never anonymous switches. */}
          <div className="hidden items-end gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium sm:flex">
            <span className="flex-1">{t('surfacesColDocument')}</span>
            <span className="w-40 shrink-0 text-center">
              {t('surfacesColSignup')}
              <span className="block font-normal text-muted-foreground">
                {t('surfacesRecordsChip')}
              </span>
            </span>
            <span className="w-64 shrink-0 text-center">
              {t('surfacesColRequired')}
              <span className="block font-normal text-muted-foreground">
                {t('surfacesRefusesChip')}
              </span>
            </span>
          </div>

          <ul>
            {published.map((d) => {
              const isWaiver = d.kind === 'waiver'
              const required = requiredOverride[d.id] ?? d.waiver?.required === true
              // Asymmetric, exactly as the callable is: turning a requirement ON
              // needs the plan, turning one OFF never does.
              const requireLocked = !canRequire && !required

              return (
                <li
                  key={d.id}
                  className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <Badge variant="secondary" className="mt-1">
                      {t(`kind_${d.kind}`)}
                    </Badge>
                  </div>

                  {/* Shown at signup — records */}
                  <div className="flex items-center justify-between gap-3 sm:w-40 sm:shrink-0 sm:justify-center">
                    <span className="text-sm sm:hidden">{t('surfacesColSignup')}</span>
                    <Switch
                      aria-label={`${t('surfacesColSignup')} — ${d.title}`}
                      checked={signupIds.includes(d.id)}
                      onCheckedChange={() => toggleSignup(d.id)}
                    />
                  </div>

                  {/* Required before booking — refuses. Rendered for EVERY kind;
                      disabled in place for the ones that cannot carry it. */}
                  <div className="flex items-start justify-between gap-3 sm:w-64 sm:shrink-0 sm:flex-col sm:items-center">
                    <span className="text-sm sm:hidden">{t('surfacesColRequired')}</span>
                    <div className="flex flex-col items-end gap-1 sm:items-center">
                      <Switch
                        aria-label={`${t('surfacesColRequired')} — ${d.title}`}
                        checked={isWaiver && required}
                        disabled={
                          !isWaiver ||
                          requireLocked ||
                          (requiredMutation.isPending &&
                            requiredMutation.variables?.documentId === d.id)
                        }
                        onCheckedChange={(value) => toggleRequired(d.id, value)}
                      />
                      {!isWaiver && (
                        <p className="text-right text-xs text-muted-foreground sm:text-center">
                          {t('surfacesNotAWaiver')} {t('surfacesNotAWaiverRemedy')}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {/* The Studio lock for the second column, shown ONCE below the list.
              PlanGate owns how an above-tier control is presented, so this is
              its prompt and not a fourth bespoke lock card; there is nothing to
              reveal when the plan allows it, hence the empty children. */}
          {!canRequire && (
            <div className="p-4">
              <PlanGate minPlan={WAIVER_MIN_PLAN}>{null}</PlanGate>
            </div>
          )}
        </>
      )}
    </section>
  )
}
