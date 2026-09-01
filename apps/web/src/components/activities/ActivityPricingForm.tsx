'use client'

/**
 * WHO CAN BOOK, AND WHAT IT COSTS — the money half of an activity, hosted by
 * the catalogue rather than by the activity dialog.
 *
 * ── WHY IT MOVED ────────────────────────────────────────────────────────────
 * These three decisions (the access tier, the newcomer trial, the drop-in
 * price) share one screen with the plan matcher, because they are the same
 * conversation: what someone is charged, and which plans change that. Split
 * across a modal and a pane, a studio answered half of it in each and could
 * never see the two halves at once — the drop-in price lived in the dialog
 * while the member rate ON that price lived in the catalogue, one scroll and
 * one modal apart (Franco, 2026-09-01).
 *
 * The dialog keeps what an activity IS: its name, kind, colour, tags, session
 * lengths, the prose, and the two switches that are not about money
 * (auto-confirm and the waitlist).
 *
 * ── ONE WRITER PER FIELD ────────────────────────────────────────────────────
 * The lesson from the course settings form, which wrote `accessRule` as a whole
 * map and silently clobbered the plan list the matcher had just saved. Two
 * components now edit one activity document, so the split is by FIELD and it is
 * absolute:
 *
 *   this form   accessRule.type, isFreeTrial, dropIn, trialEnabled,
 *               trialPriceAmount
 *   the matcher accessRule.subscriptionTypeIds, memberBenefit
 *   the dialog  everything else — and it no longer names any field above
 *
 * `accessRule` is the one shared map, so this form writes `accessRule.type` as
 * a FIELD PATH and never touches the sibling id list. It cannot clobber a list
 * it cannot address.
 *
 * APPOINTMENTS HAVE NO ARM HERE. An appointment's price is its gate, its
 * durations carry their own prices, and it has neither a drop-in nor a trial —
 * so it gets the matcher alone.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { doc, updateDoc } from 'firebase/firestore'
import { toast } from 'sonner'
import {
  ACTIVITIES_COLLECTION,
  isAppointmentActivity,
  resolveActivityAccessRule,
  type Activity,
  type SubscriptionType,
} from '@linyup/shared'
import { db } from '@/lib/firebase'
import { useInvalidateSetupChecklist } from '@/hooks/useSetupChecklist'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ActivityPlanLinks } from '@/components/offer/ActivityPlanLinks'

type AccessTier = 'open' | 'members' | 'subscription'

/** Major-unit price string → number. Accepts a comma decimal separator. */
function parsePrice(raw: string): number {
  return parseFloat(raw.replace(',', '.'))
}

interface Draft {
  accessTier: AccessTier
  trialEnabled: boolean
  trialPrice: string
  dropInEnabled: boolean
  dropInPrice: string
}

function draftOf(a: Activity): Draft {
  return {
    accessTier: resolveActivityAccessRule(a).type as AccessTier,
    trialEnabled: a.trialEnabled ?? false,
    trialPrice: a.trialPriceAmount != null ? String(a.trialPriceAmount) : '',
    dropInEnabled: a.dropIn?.enabled ?? false,
    dropInPrice: a.dropIn?.priceAmount != null ? String(a.dropIn.priceAmount) : '',
  }
}

function same(a: Draft, b: Draft): boolean {
  return (
    a.accessTier === b.accessTier &&
    a.trialEnabled === b.trialEnabled &&
    a.trialPrice === b.trialPrice &&
    a.dropInEnabled === b.dropInEnabled &&
    a.dropInPrice === b.dropInPrice
  )
}

export function ActivityPricingForm({
  activity,
  plans,
  currency,
  canEdit,
}: {
  /** The LIVE document from the activities query — the matcher below writes the
   *  same doc, so a snapshot would go stale under this form. */
  activity: Activity
  plans: SubscriptionType[]
  currency: string
  canEdit: boolean
}) {
  const t = useTranslations('Activities')
  const tCat = useTranslations('OfferCatalogue')
  const qc = useQueryClient()
  const invalidateSetupChecklist = useInvalidateSetupChecklist()

  const stored = draftOf(activity)
  const [draft, setDraft] = useState<Draft>(stored)
  const [saving, setSaving] = useState(false)
  // Re-seed when the selection changes, or when the stored document changes
  // under us (the matcher writes it, and a save here refetches it).
  useEffect(() => {
    setDraft(draftOf(activity))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id, JSON.stringify(draftOf(activity))])

  const isAppointment = isAppointmentActivity(activity)
  // Read off the DRAFT tier, not the stored one: picking "Any member" should
  // reveal the plan table there and then, the same way the course's sell
  // switch reveals its rate columns.
  const noPlanEdge = !isAppointment && draft.accessTier === 'open'
  /**
   * THE MATCHER READS THE DRAFT TIER, not the stored one.
   *
   * Its facets come from the document it is handed, so on a class still stored
   * as `open` every column was a dash until this form had been saved — picking
   * "Any member" revealed an empty grid rather than a usable one. The PLAN IDS
   * still come from the stored activity: the matcher owns those and this form
   * does not.
   */
  const draftActivity: Activity = isAppointment
    ? activity
    : {
        ...activity,
        accessRule: {
          type: draft.accessTier,
          ...(resolveActivityAccessRule(activity).subscriptionTypeIds?.length
            ? { subscriptionTypeIds: resolveActivityAccessRule(activity).subscriptionTypeIds }
            : {}),
        },
      }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const dropInPriceInvalid =
    draft.dropInEnabled && !(draft.dropInPrice.trim() !== '' && parsePrice(draft.dropInPrice) >= 0.5)
  const trialPriceInvalid =
    draft.trialPrice.trim() !== '' && !(parsePrice(draft.trialPrice) >= 0.5)
  const invalid = dropInPriceInvalid || trialPriceInvalid
  const dirty = !same(draft, stored)

  async function save() {
    if (invalid || !dirty) return
    setSaving(true)
    try {
      await updateDoc(doc(db, ACTIVITIES_COLLECTION, activity.id), {
        // A FIELD PATH, not the whole map: `accessRule.subscriptionTypeIds` is
        // the matcher's and must survive every save from here.
        'accessRule.type': draft.accessTier,
        isFreeTrial: draft.accessTier === 'open',
        dropIn: {
          enabled: draft.dropInEnabled,
          ...(draft.dropInPrice ? { priceAmount: parsePrice(draft.dropInPrice) } : {}),
        },
        trialEnabled: draft.trialEnabled,
        // Cleared on an open tier — the field is hidden there (the trial door
        // grants nothing extra on a free-to-book class), so a leftover price
        // must not survive as inert data the UI cannot show.
        trialPriceAmount:
          draft.trialPrice && draft.accessTier !== 'open' ? parsePrice(draft.trialPrice) : null,
      })
      await qc.invalidateQueries({ queryKey: ['activities'] })
      // "Set a price" is a derived setup step keyed on `dropIn.enabled`.
      void invalidateSetupChecklist()
      toast.success(t('savedToast'))
    } finally {
      setSaving(false)
    }
  }

  const row = 'flex items-center justify-between gap-4 p-3'

  return (
    <div className="space-y-4">
      {!isAppointment && (
        <>
          <div className="space-y-2">
            <Label>{t('accessLabel')}</Label>
            {/* Selectable tier cards — the same pattern the availability form's
                mode toggle uses. */}
            <div className="grid gap-2 lg:grid-cols-3">
              {(['open', 'members', 'subscription'] as const).map((tier) => (
                <label
                  key={tier}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
                    draft.accessTier === tier
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-foreground/30'
                  } ${canEdit ? '' : 'pointer-events-none opacity-60'}`}
                >
                  <input
                    type="radio"
                    className="mt-0.5 accent-primary"
                    checked={draft.accessTier === tier}
                    onChange={() => set('accessTier', tier)}
                    disabled={!canEdit}
                  />
                  <span>
                    {/* Four literal keys per group, never `t(\`access_${tier}\`)`:
                        i18n:check counts computed keys and never fails them. */}
                    <span className="font-medium">
                      {tier === 'open'
                        ? t('access_open')
                        : tier === 'members'
                          ? t('access_members')
                          : t('access_subscription')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tier === 'open'
                        ? t('access_open_desc')
                        : tier === 'members'
                          ? t('access_members_desc')
                          : t('access_subscription_desc')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="divide-y rounded-lg border">
            {/* Independent of the access tier above — a gated class may still
                take a newcomer's trial booking. */}
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium">{t('fieldTrialEnabled')}</p>
                  <p className="text-xs text-muted-foreground">{t('trialEnabledHint')}</p>
                </div>
                <input
                  type="checkbox"
                  className="shrink-0 accent-primary"
                  checked={draft.trialEnabled}
                  onChange={(e) => set('trialEnabled', e.target.checked)}
                  disabled={!canEdit}
                />
              </div>
              {/* Only on a GATED class — on an open one the trial door grants
                  nothing extra (everyone books free), so a price there would be
                  silently ignored by `bookSession`. */}
              {draft.trialEnabled && draft.accessTier !== 'open' && (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 pr-4">
                    <p className="text-xs font-medium">{t('trialPriceLabel')}</p>
                    <p className="text-xs text-muted-foreground">{t('trialPriceHint')}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{currency}</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.trialPrice}
                      onChange={(e) => set('trialPrice', e.target.value)}
                      placeholder={t('trialPricePlaceholder')}
                      className="h-8 w-24 text-sm"
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              )}
              {trialPriceInvalid && (
                <p className="text-xs text-destructive">{t('trialPriceValidation')}</p>
              )}
            </div>

            <div className="space-y-2 p-3">
              <div className={row.replace(' p-3', '')}>
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium">{t('dropInLabel')}</p>
                  <p className="text-xs text-muted-foreground">{t('dropInHelp')}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={draft.dropInEnabled}
                    onChange={(e) => set('dropInEnabled', e.target.checked)}
                    disabled={!canEdit}
                  />
                  {draft.dropInEnabled && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{currency}</span>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.dropInPrice}
                        onChange={(e) => set('dropInPrice', e.target.value)}
                        placeholder={t('dropInPricePlaceholder')}
                        className="h-8 w-24 text-sm"
                        disabled={!canEdit}
                      />
                    </div>
                  )}
                </div>
              </div>
              {dropInPriceInvalid && (
                <p className="text-xs text-destructive">{t('dropInPriceValidation')}</p>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center justify-end gap-3">
              {dirty && (
                <span className="text-xs text-muted-foreground">{tCat('unsaved')}</span>
              )}
              <Button size="sm" disabled={!dirty || invalid || saving} onClick={() => void save()}>
                {saving ? tCat('saving') : tCat('save')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* WHERE THE MATCHER WOULD BE, on a class no plan can bear on. An open
          class is free to book for everybody: nothing for a plan to open, and
          no price for one to reduce. The switch that changes that is directly
          above, which is why this sentence sits here and not on the pane. */}
      {noPlanEdge ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          {tCat('openNoPlanEdge')}
        </p>
      ) : (
      <div className={isAppointment ? '' : 'border-t pt-4'}>
        <ActivityPlanLinks
          direction="from-offering"
          offering={{
            id: activity.id,
            name: activity.name,
            collection: ACTIVITIES_COLLECTION,
            color: activity.color ?? '',
            target: { kind: 'activity', doc: draftActivity },
          }}
          offerings={[]}
          plans={plans}
          currency={currency}
          canEdit={canEdit}
          hostedInForm
          // The matcher's transaction reads the STORED activity, so an unsaved
          // tier has to land first or a tick is computed against the old one —
          // the same seam the course settings form uses.
          onBeforeSave={async () => {
            if (draft.accessTier === stored.accessTier) return
            await updateDoc(doc(db, ACTIVITIES_COLLECTION, activity.id), {
              'accessRule.type': draft.accessTier,
              isFreeTrial: draft.accessTier === 'open',
            })
            await qc.invalidateQueries({ queryKey: ['activities'] })
          }}
        />
      </div>
      )}
    </div>
  )
}
