'use client'

// ─── THE ONE EDGE EDITOR ─────────────────────────────────────────────────────
//
// One component, mounted in BOTH directions. `direction` decides only what each
// ROW is labelled by — a plan name, or an activity name. The controls, the
// validation and the write are identical, which is what makes "same edge, from
// either side" a property of the code rather than a claim about it. The write
// itself is `activityPlanEdgeUpdate` in @linyup/shared, pinned by
// packages/functions/src/offer/activityPlanLink.test.ts.
//
// It REPLACES two editors that each owned a copy of where to write: the access
// tier + benefit blocks in offer/activities/page.tsx, and "Activities this
// subscription unlocks" in components/subscriptions/SubscriptionTypesManager.
//
// ── TWO CONTROLS PER ROW, BECAUSE THERE ARE TWO FACTS ───────────────────────
// ACCESS ("may they book it") and RATE ("what do they pay") are independent — a
// class can be gated to Premium AND give Premium a drop-in rate. An appointment
// has no access facet at all (the price is the gate), so that control is absent
// on those rows rather than present-and-ignored.
//
// ── THE RATE WARNING IS LOAD-BEARING ────────────────────────────────────────
// `memberBenefit` is ONE rule per activity, shared by every plan on it. Setting
// "20% off" from Premium reprices Basic and Gold too. The warning NAMES them and
// appears while the draft is being edited — BEFORE Save, because there is no
// per-pair slot to fall back on and no undo afterwards. Never make it
// dismissible, never move it after the write.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { doc, runTransaction } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, AlertTriangle } from 'lucide-react'

import {
  ACTIVITIES_COLLECTION,
  activityPlanEdge,
  activityPlanEdgeUpdate,
  activityRateChoiceOf,
  isAppointmentActivity,
  plansSharingRate,
  type Activity,
  type ActivityPlanEdge,
  type ActivityRateChoice,
  type SubscriptionType,
} from '@linyup/shared'
import { db } from '@/lib/firebase'
import { Link } from '@/i18n/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const DEFAULT_ACCENT = '#6366f1'

/** Effects a rate may carry. `spend_credits` is never offered — the resolver
 *  supports it but no editor writes it (see BenefitEditor's module doc). */
const RATE_EFFECTS = ['included', 'percent_off', 'fixed_price'] as const
type RateEffect = (typeof RATE_EFFECTS)[number]

/** Draft state is kept as STRINGS, so a half-typed "2" in a percent field is not
 *  read as the number 2 and saved by a stray click. */
interface RateDraft {
  effect: RateEffect
  percent: string
  amount: string
}

/** One pending change, keyed by the pair it belongs to. */
interface RowDraft {
  edge: ActivityPlanEdge
  rate: RateDraft
}

function rateDraftOf(a: Activity): RateDraft {
  const c = activityRateChoiceOf(a)
  return {
    effect: (RATE_EFFECTS as readonly string[]).includes(c.effect)
      ? (c.effect as RateEffect)
      : 'included',
    percent: c.percent != null ? String(c.percent) : '',
    amount: c.amount != null ? String(c.amount) : '',
  }
}

function toChoice(d: RateDraft): ActivityRateChoice {
  return {
    effect: d.effect,
    percent: d.percent.trim() === '' ? null : Number(d.percent),
    amount: d.amount.trim() === '' ? null : Number(d.amount),
  }
}

/** 1–99 integer, and >= 0.50 (Stripe's floor) — the same rules the standalone
 *  BenefitEditor enforces, so a rate saved here cannot be one that editor
 *  refuses. */
function rateError(d: RateDraft): 'percent' | 'amount' | null {
  if (d.effect === 'percent_off') {
    const n = Number(d.percent)
    if (!(d.percent.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 99)) return 'percent'
  }
  if (d.effect === 'fixed_price') {
    const n = Number(d.amount)
    if (!(d.amount.trim() !== '' && Number.isFinite(n) && n >= 0.5)) return 'amount'
  }
  return null
}

export type EdgeDirection = 'from-activity' | 'from-plan'

export function ActivityPlanLinks({
  direction,
  activity,
  plan,
  activities,
  plans,
  currency,
  canEdit,
}: {
  direction: EdgeDirection
  /** The fixed side when direction is 'from-activity'. */
  activity?: Activity
  /** The fixed side when direction is 'from-plan'. */
  plan?: SubscriptionType
  activities: Activity[]
  plans: SubscriptionType[]
  currency: string
  canEdit: boolean
}) {
  const t = useTranslations('OfferCatalogue')
  const tb = useTranslations('Benefit')
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  // Rows are the OTHER side. Everything below is written against (activity,
  // plan) pairs, so the two directions differ only in which of the two each row
  // supplies.
  const rows = useMemo(() => {
    if (direction === 'from-activity') {
      return plans.map((p) => ({ key: p.id, plan: p, act: activity! }))
    }
    return activities.map((a) => ({ key: a.id, plan: plan!, act: a }))
  }, [direction, plans, activities, activity, plan])

  const draftFor = (key: string, act: Activity, planId: string): RowDraft =>
    drafts[key] ?? { edge: activityPlanEdge(act, planId), rate: rateDraftOf(act) }

  const setDraft = (key: string, next: RowDraft) => setDrafts((d) => ({ ...d, [key]: next }))

  const dirty = Object.keys(drafts).length > 0
  const errors = rows
    .map((r) => {
      const d = draftFor(r.key, r.act, r.plan.id)
      return d.edge.rate ? rateError(d.rate) : null
    })
    .filter(Boolean)

  async function save() {
    if (errors.length) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    try {
      // One transaction over every touched activity. Each document is re-read
      // INSIDE it and the id lists recomputed from that read, so a second studio
      // ticking a different plan on the same activity merges rather than losing.
      await runTransaction(db, async (tx) => {
        const touched = rows.filter((r) => drafts[r.key])
        const snaps = await Promise.all(
          touched.map((r) => tx.get(doc(db, ACTIVITIES_COLLECTION, r.act.id)))
        )
        snaps.forEach((snap, i) => {
          if (!snap.exists()) return
          const r = touched[i]
          const d = drafts[r.key]
          const update = activityPlanEdgeUpdate(
            snap.data() as Activity,
            r.plan.id,
            d.edge,
            d.edge.rate ? toChoice(d.rate) : undefined
          )
          if (update) tx.update(snap.ref, update)
        })
      })
      setDrafts({})
      setShowErrors(false)
      await qc.invalidateQueries({ queryKey: ['activities'] })
    } finally {
      setSaving(false)
    }
  }

  // ── empty states ──
  // Both name a destination AND link it (UX-99): the mirror-image empty states
  // these replace each named one and went nowhere.
  if (direction === 'from-activity' && plans.length === 0) {
    return (
      <EmptyLink text={t('noPlans')} action={t('noPlansAction')} href={'/offer/plans' as Route} />
    )
  }
  if (direction === 'from-plan' && activities.length === 0) {
    return (
      <EmptyLink
        text={t('noActivities')}
        action={t('noActivitiesAction')}
        href={'/offer/activities' as Route}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">
          {direction === 'from-activity' ? t('plansHeading') : t('includesHeading')}
        </p>
        <p className="text-xs text-muted-foreground">
          {direction === 'from-activity' ? t('plansHint') : t('includesHint')}
        </p>
      </div>

      <div className="space-y-1.5">
        {rows.map(({ key, act, plan: p }) => {
          const d = draftFor(key, act, p.id)
          const appointment = isAppointmentActivity(act)
          const label = direction === 'from-activity' ? p.name : act.name
          // Everyone ELSE on this activity's ONE rate rule — named, because the
          // effect chosen here applies to them too. Read from the SAVED document
          // plus the draft, so a plan just ticked on is already counted.
          const others = plansSharingRate(act, p.id)
          const sharedWith = [...new Set(others)]
            .map((id) => plans.find((s) => s.id === id)?.name)
            .filter((n): n is string => !!n)
          const err = showErrors && d.edge.rate ? rateError(d.rate) : null
          const active = d.edge.access || d.edge.rate

          return (
            <div
              key={key}
              className={active ? 'rounded-md border bg-card p-2.5 space-y-2' : 'px-0.5 py-1'}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  {direction === 'from-plan' && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: act.color || DEFAULT_ACCENT }}
                    />
                  )}
                  <span className="truncate">{label}</span>
                  {direction === 'from-plan' && appointment && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {t('appointmentBadge')}
                    </Badge>
                  )}
                </span>

                {/* An appointment has NO access gate — the price is the gate —
                    so the control is absent, not disabled: a greyed checkbox
                    reads as "not yet", and this is "never". */}
                {!appointment && (
                  <Toggle
                    label={t('accessToggle')}
                    checked={d.edge.access}
                    disabled={!canEdit}
                    onChange={(v) => setDraft(key, { ...d, edge: { ...d.edge, access: v } })}
                  />
                )}
                <Toggle
                  label={t('rateToggle')}
                  checked={d.edge.rate}
                  disabled={!canEdit}
                  onChange={(v) => setDraft(key, { ...d, edge: { ...d.edge, rate: v } })}
                />
              </div>

              {d.edge.rate && (
                <div className="space-y-1.5 pl-1">
                  <div className="flex flex-wrap gap-1.5">
                    {RATE_EFFECTS.map((effect) => (
                      <button
                        key={effect}
                        type="button"
                        disabled={!canEdit}
                        aria-pressed={d.rate.effect === effect}
                        onClick={() => setDraft(key, { ...d, rate: { ...d.rate, effect } })}
                        className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                          d.rate.effect === effect
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                        }`}
                      >
                        {tb(`effect_${effect}` as const)}
                      </button>
                    ))}
                  </div>
                  {d.rate.effect === 'percent_off' && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={99}
                        value={d.rate.percent}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setDraft(key, { ...d, rate: { ...d.rate, percent: e.target.value } })
                        }
                        placeholder="20"
                        className="h-8 w-20 text-sm"
                        aria-label={tb('percentLabel')}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                  {d.rate.effect === 'fixed_price' && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={0.5}
                        step="0.01"
                        value={d.rate.amount}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setDraft(key, { ...d, rate: { ...d.rate, amount: e.target.value } })
                        }
                        placeholder="0.00"
                        className="h-8 w-24 text-sm"
                        aria-label={tb('amountLabel')}
                      />
                      <span className="text-xs text-muted-foreground">{currency}</span>
                    </div>
                  )}
                  {err && (
                    <p className="text-xs text-destructive">
                      {tb(err === 'percent' ? 'percentValidation' : 'amountValidation')}
                    </p>
                  )}
                  {/* THE WARNING. Before the write, naming names. */}
                  {sharedWith.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t('sharedRule', { names: sharedWith.join(', ') })}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 border-t pt-3">
          {dirty && <span className="text-xs text-muted-foreground">{t('unsaved')}</span>}
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** A checkbox with its name beside it — the pair of controls a row carries. */
function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
      <input
        type="checkbox"
        className="accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function EmptyLink({ text, action, href }: { text: string; action: string; href: Route }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{text}</p>
      <Link href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        <Plus className="h-3.5 w-3.5" />
        {action}
      </Link>
    </div>
  )
}
