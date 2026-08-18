'use client'

// ONE LIST OF DOCUMENTS. Consent membership is a PROPERTY OF THE ROW.
//
// ── WHY THIS FILE REPLACED DocumentSurfaces ─────────────────────────────────
// Documents used to appear twice on this page: a "where documents are asked
// for" panel listing the published ones with two switches, and then the real
// list of every document underneath. One set of objects, two lists, and a
// studio reading the page had to work out that a title in the panel and the
// same title in the grid were the same document (UX-93). They are now one list
// whose rows carry the switches — a row IS the document, and what it is
// attached to is a property of it, not a second inventory.
//
// ── THE TWO SWITCHES ARE NOT PEERS, AND THE COPY SAYS SO ────────────────────
// This is the whole reason the panel was built, and none of it is lost by the
// merge — the sentence moved to the top of the list, and the column headers
// still carry it:
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
// The two mechanisms are deliberately kept as they are — this is a surface
// merge, not a data migration.
//
// ── A CONTROL IS DISABLED IN PLACE, NEVER HIDDEN ────────────────────────────
// Only a PUBLISHED document can be attached to either rail (there is no version
// to point at otherwise), and only a WAIVER can carry a requirement
// (`waiverPolicyEntryFor` returns null for every other kind). Hiding the
// controls on the rows that cannot take them is exactly what made those limits
// invisible: a manager authoring "House Rules" reaches for `Regulation`, not the
// legally-loaded word, and then sees nothing missing. So the switches are
// rendered on every row, disabled, WITH the reason and the remedy beside them.
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
import { Copy, FileText, Globe, Link2 } from 'lucide-react'
import { WAIVER_MIN_PLAN } from '@linyup/shared'
import type { StudioDocument, DocumentStatus } from '@linyup/shared'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { PlanGate } from '@/components/plan/PlanGate'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  useSignupDocumentIds,
  saveSignupDocumentIds,
  setWaiverRequirement,
  waiverCallableError,
} from '@/plugins/documents/hooks'

const STATUS_BADGE: Record<DocumentStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

export function DocumentsList({
  documents,
  onOpen,
  onDuplicate,
  duplicating,
}: {
  /** Already searched/filtered by the page — this component never filters. */
  documents: StudioDocument[]
  onOpen: (documentId: string) => void
  onDuplicate: (document: StudioDocument) => void
  duplicating: boolean
}) {
  const t = useTranslations('Documents')
  const tCommon = useTranslations('Common')
  const tWaivers = useTranslations('Waivers')
  const { currentTeamId } = useAuth()
  const qc = useQueryClient()
  const { isAtLeast } = usePlan()
  const canRequire = isAtLeast(WAIVER_MIN_PLAN)

  // `idsLoading` is not cosmetic. `saveSignupDocumentIds` writes the WHOLE
  // list, so a switch flipped before the stored selection has arrived would
  // save `[thisOne]` and silently drop every other attached document. The
  // control waits for its own data.
  const { data: savedIds, isLoading: idsLoading } = useSignupDocumentIds(currentTeamId)

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
    <div className="rounded-xl border bg-card">
      {/* THE SENTENCE. Which column records, which column refuses — at the top
          of the one list, where every row is subject to it. */}
      <p className="border-b p-4 text-sm text-muted-foreground">{t('surfacesExplainer')}</p>

      {/* Column headers — sm+ only. Each row carries its own labels on mobile,
          so the two switches are never anonymous. */}
      <div className="hidden items-end gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium sm:flex">
        <span className="flex-1">{t('surfacesColDocument')}</span>
        <span className="w-40 shrink-0 text-center">
          {t('surfacesColSignup')}
          <span className="block font-normal text-muted-foreground">{t('surfacesRecordsChip')}</span>
        </span>
        <span className="w-64 shrink-0 text-center">
          {t('surfacesColRequired')}
          <span className="block font-normal text-muted-foreground">{t('surfacesRefusesChip')}</span>
        </span>
      </div>

      <ul>
        {documents.map((d) => {
          const isWaiver = d.kind === 'waiver'
          const isPublished = d.status === 'published'
          const required = requiredOverride[d.id] ?? d.waiver?.required === true
          const attachedAtSignup = signupIds.includes(d.id)
          // Asymmetric, exactly as the callable is: turning a requirement ON
          // needs the plan, turning one OFF never does.
          const requireLocked = !canRequire && !required
          // Same asymmetry for the publish state, and for the same reason: only
          // a published document can be ATTACHED (there is no version to point
          // at), but a document that is already attached and then unpublished
          // must always be detachable — a disabled switch stuck in the ON
          // position is a consent a studio cannot withdraw.
          const signupLocked = idsLoading || (!isPublished && !attachedAtSignup)
          const requirePublishLocked = !isPublished && !required
          const SourceIcon = d.source === 'external_link' ? Link2 : FileText
          // A waiver is callable-only in every direction (see duplicateDocument),
          // so it gets no copy control rather than one the rules would refuse.
          const canDuplicate = !isWaiver

          return (
            <li
              key={d.id}
              className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <div className="min-w-0 flex-1">
                  {/* The title opens the editor. A button, not a wrapper around
                      the whole row — the row holds switches, and nesting one
                      control inside another is invalid markup and unusable with
                      a keyboard. */}
                  <button
                    type="button"
                    onClick={() => onOpen(d.id)}
                    className="flex max-w-full items-center gap-1.5 text-left text-sm font-medium hover:text-primary"
                  >
                    <SourceIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{d.title}</span>
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[d.status]}`}
                    >
                      {t(`status_${d.status}`)}
                    </span>
                    <Badge variant="secondary">{t(`kind_${d.kind}`)}</Badge>
                    {d.current_version != null && (
                      <Badge variant="outline">{t('versionN', { version: d.current_version })}</Badge>
                    )}
                    {isPublished && d.isPublic && (
                      <Badge variant="outline" className="gap-1 border-green-500/50 text-green-600">
                        <Globe className="h-3 w-3" />
                        {t('publicBadge')}
                      </Badge>
                    )}
                  </div>
                </div>
                {canDuplicate && (
                  <button
                    type="button"
                    onClick={() => onDuplicate(d)}
                    disabled={duplicating}
                    title={tCommon('duplicate')}
                    aria-label={`${tCommon('duplicate')} — ${d.title}`}
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Shown at signup — records */}
              <div className="flex items-start justify-between gap-3 sm:w-40 sm:shrink-0 sm:flex-col sm:items-center">
                <span className="text-sm sm:hidden">{t('surfacesColSignup')}</span>
                <div className="flex flex-col items-end gap-1 sm:items-center">
                  <Switch
                    aria-label={`${t('surfacesColSignup')} — ${d.title}`}
                    checked={attachedAtSignup}
                    disabled={signupLocked}
                    onCheckedChange={() => toggleSignup(d.id)}
                  />
                  {signupLocked && !idsLoading && (
                    <p className="text-right text-xs text-muted-foreground sm:text-center">
                      {t('surfacesPublishFirst')}
                    </p>
                  )}
                </div>
              </div>

              {/* Required before booking — refuses. Rendered for EVERY row;
                  disabled in place for the ones that cannot carry it. */}
              <div className="flex items-start justify-between gap-3 sm:w-64 sm:shrink-0 sm:flex-col sm:items-center">
                <span className="text-sm sm:hidden">{t('surfacesColRequired')}</span>
                <div className="flex flex-col items-end gap-1 sm:items-center">
                  <Switch
                    aria-label={`${t('surfacesColRequired')} — ${d.title}`}
                    checked={isWaiver && required}
                    disabled={
                      !isWaiver ||
                      requirePublishLocked ||
                      requireLocked ||
                      (requiredMutation.isPending &&
                        requiredMutation.variables?.documentId === d.id)
                    }
                    onCheckedChange={(value) => toggleRequired(d.id, value)}
                  />
                  {!isWaiver ? (
                    <p className="text-right text-xs text-muted-foreground sm:text-center">
                      {t('surfacesNotAWaiver')} {t('surfacesNotAWaiverRemedy')}
                    </p>
                  ) : requirePublishLocked ? (
                    <p className="text-right text-xs text-muted-foreground sm:text-center">
                      {t('surfacesPublishFirst')}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {/* The Studio lock for the second column, shown ONCE below the list.
          PlanGate owns how an above-tier control is presented, so this is its
          prompt and not a bespoke lock card; there is nothing to reveal when the
          plan allows it, hence the empty children. */}
      {!canRequire && (
        <div className="border-t p-4">
          <PlanGate minPlan={WAIVER_MIN_PLAN}>{null}</PlanGate>
        </div>
      )}
    </div>
  )
}
