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
// ACCESS ("is it included free") and RATE ("what do they pay otherwise") are
// independent — a class can be included in Premium AND give Premium a reduced
// drop-in rate. An appointment has no access facet at all (the price is the
// gate), so that control is absent on those rows rather than
// present-and-ignored.
//
// BOTH TICKED IS NOT A CONTRADICTION, and the row says so out loud. It looks
// like one — included free, and yet a rate? — which is why every row carries a
// one-line outcome underneath. The pair is exactly what a LIMITED plan needs:
// "3 a week included, the member rate after that". Reading the two checkboxes
// as mutually exclusive is the single most common way this screen is
// misunderstood, so the sentence is not decoration and must not be dropped to
// save a line.
//
// ── THE RATE WARNING IS LOAD-BEARING ────────────────────────────────────────
// `memberBenefit` is ONE rule per activity, shared by every plan on it. Setting
// "20% off" from Premium reprices Basic and Gold too. The warning NAMES them and
// appears while the draft is being edited — BEFORE Save, because there is no
// per-pair slot to fall back on and no undo afterwards. Never make it
// dismissible, never move it after the write.

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { doc, runTransaction } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, AlertTriangle } from 'lucide-react'

import {
  offeringFacets,
  offeringPlanEdge,
  offeringPlanEdgeUpdate,
  offeringRateChoiceOf,
  offeringRateEffects,
  rateHasAPriceToApplyTo,
  resolveUsageLimit,
  isAppointmentActivity,
  type OfferingFacets,
  plansSharingOfferingRate,
  type ActivityPlanEdge,
  type ActivityRateChoice,
  type OfferableRateEffect,
  type PlanLinkTarget,
  type SubscriptionType,
} from '@linyup/shared'
import { db } from '@/lib/firebase'
import { Link } from '@/i18n/navigation'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/layout/SectionHeading'

const DEFAULT_ACCENT = '#6366f1'

/** Effects a rate may carry, per offering — `offeringRateEffects` derives them
 *  from the sets the RESOLVER honours, so this editor can no longer offer an
 *  effect that would be ignored (it used to offer `included` on a class, where
 *  coverage is the access facet's job and the benefit is a price rule). */
type RateEffect = OfferableRateEffect

// ── ONE EXCLUSIVE CHOICE PER ROW ────────────────────────────────────────────
// What a plan does to an offering is ONE answer, so the row asks for one. It
// used to ask twice — an "access" checkbox and a "rate" checkbox, each with its
// own vocabulary — and the pair was unreadable in both directions: on an
// unlimited plan the two were genuinely exclusive (a covered member never
// reaches the drop-in price, so a rate beside it is dead), while on a class the
// rate's own "Included" effect looked like a second way to say the same thing
// and in fact did nothing at all.
//
// The choice below is the studio's question — "is this in the plan, or cheaper,
// or neither?" — and the two stored facets are an implementation detail this
// component maps to. WHICH facet stores "Included" depends on the offering: a
// class or a subscription-tier course has an access gate; an appointment or a
// purchase-tier course has none (the price is the gate) and says it with the
// `included` rate effect instead. The studio never has to know which.
type RowChoice = 'none' | RateEffect

/** The options this offering can honour, in a fixed order. */
function rowChoicesFor(t: PlanLinkTarget): RowChoice[] {
  const facets = offeringFacets(t)
  if (!facets.access && !facets.rate) return []
  const effects = facets.rate ? offeringRateEffects(t) : []
  // `included` comes from the ACCESS facet where there is one, and from the rate
  // vocabulary where there is not — either way it is offered exactly once.
  const included: RowChoice[] = facets.access ? ['included'] : []
  return ['none', ...included, ...effects.filter((e) => !(facets.access && e === 'included'))]
}

/** Which option the stored edge currently represents. */
function choiceOf(edge: ActivityPlanEdge, rate: RateDraft, facets: OfferingFacets): RowChoice {
  if (edge.access) return 'included' // with or without an after-allowance rate
  if (!edge.rate) return 'none'
  return facets.access && rate.effect === 'included' ? 'none' : rate.effect
}

/**
 * The edge a choice writes. `keepAfterAllowance` preserves the second, optional
 * answer a LIMITED plan can give (see `AfterAllowance` below) — every other
 * choice clears it, because a rate beside "not included" or beside a discount is
 * not a state the studio asked for.
 */
function edgeForChoice(
  choice: RowChoice,
  facets: OfferingFacets,
  keepAfterAllowance: boolean
): ActivityPlanEdge {
  if (choice === 'none') return { access: false, rate: false }
  if (choice === 'included') {
    return facets.access
      ? { access: true, rate: keepAfterAllowance }
      : { access: false, rate: true }
  }
  return { access: false, rate: true }
}

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

function rateDraftOf(t: PlanLinkTarget): RateDraft {
  const c = offeringRateChoiceOf(t)
  const offerable = offeringRateEffects(t)
  return {
    // A stored effect this offering cannot honour falls back to the first one it
    // can. Nothing is rewritten by reading — a row is only saved once the studio
    // touches it — so this surfaces an inert rule rather than hiding it.
    effect: offerable.includes(c.effect as RateEffect)
      ? (c.effect as RateEffect)
      : offerable[0],
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

export type EdgeDirection = 'from-offering' | 'from-plan'

/** An activity or a course, flattened to what a row needs plus the document the
 *  writer dispatches on. Products and gift cards are absent by construction —
 *  see the note above `PlanLinkTarget` in @linyup/shared. */
export interface Offering {
  id: string
  name: string
  /** Firestore collection the document lives in — the transaction reads it back
   *  from here before writing. */
  collection: string
  target: PlanLinkTarget
  color?: string
  /** A short word for what kind it is, shown on the row in the plan direction. */
  badge?: string
}

export function ActivityPlanLinks({
  direction,
  offering,
  plan,
  offerings,
  plans,
  currency,
  canEdit,
  hostedInForm,
  onDirtyChange,
}: {
  direction: EdgeDirection
  /** The fixed side when direction is 'from-offering'. */
  offering?: Offering
  /** The fixed side when direction is 'from-plan'. */
  plan?: SubscriptionType
  offerings: Offering[]
  plans: SubscriptionType[]
  currency: string
  canEdit: boolean
  /**
   * Mounted INSIDE a form that already holds unsaved input — today the activity
   * dialog. Two things change: the empty state names its destination without
   * LINKING it (a client-side push out of a half-filled dialog discards every
   * field the studio typed, which is the defect the in-place editor exists to
   * remove), and the host is told when this editor holds ticks of its own.
   */
  hostedInForm?: boolean
  /** Called whenever this editor gains or loses unsaved ticks, so a host with
   *  its own Save can say that pressing it will not write them. Pass a STABLE
   *  function (a setState updater) — it is an effect dependency. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const t = useTranslations('OfferCatalogue')
  const tb = useTranslations('Benefit')
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  // Rows are the OTHER side. Everything below is written against (offering,
  // plan) pairs, so the two directions differ only in which of the two each row
  // supplies.
  const rows = useMemo(() => {
    if (direction === 'from-offering') {
      return plans.map((p) => ({ key: p.id, plan: p, off: offering! }))
    }
    return offerings.map((o) => ({ key: o.id, plan: plan!, off: o }))
  }, [direction, plans, offerings, offering, plan])

  const draftFor = (key: string, off: Offering, planId: string): RowDraft =>
    drafts[key] ?? {
      edge: offeringPlanEdge(off.target, planId),
      rate: rateDraftOf(off.target),
    }

  const setDraft = (key: string, next: RowDraft) => setDrafts((d) => ({ ...d, [key]: next }))

  /** Set every row that can honour this choice to it, in one draft update. */
  const setColumn = (choice: RowChoice) => {
    if (!canEdit) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const r of rows) {
        if (!rowChoicesFor(r.off.target).includes(choice)) continue
        const cur =
          prev[r.key] ?? {
            edge: offeringPlanEdge(r.off.target, r.plan.id),
            rate: rateDraftOf(r.off.target),
          }
        const facets = offeringFacets(r.off.target)
        next[r.key] = {
          edge: edgeForChoice(choice, facets, false),
          rate:
            choice === 'none' || choice === 'included'
              ? cur.rate
              : { ...cur.rate, effect: choice },
        }
      }
      return next
    })
  }

  const dirty = Object.keys(drafts).length > 0
  // Reported upward rather than merely shown here: the host's Save writes the
  // SAME document this editor writes, and it writes the STORED plan list — so a
  // tick that has not been saved here is discarded by that Save.
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])
  const errors = rows
    .map((r) => {
      const d = draftFor(r.key, r.off, r.plan.id)
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
      // One transaction over every touched document, whatever kind it is. Each
      // is re-read INSIDE the transaction and its id lists recomputed from that
      // read, so a second studio ticking a different plan on the same offering
      // merges rather than losing.
      await runTransaction(db, async (tx) => {
        const touched = rows.filter((r) => drafts[r.key])
        const snaps = await Promise.all(
          touched.map((r) => tx.get(doc(db, r.off.collection, r.off.id)))
        )
        snaps.forEach((snap, i) => {
          if (!snap.exists()) return
          const r = touched[i]
          const d = drafts[r.key]
          const update = offeringPlanEdgeUpdate(
            { kind: r.off.target.kind, doc: snap.data() } as PlanLinkTarget,
            r.plan.id,
            d.edge,
            d.edge.rate ? toChoice(d.rate) : undefined
          )
          if (update) tx.update(snap.ref, update)
        })
      })
      setDrafts({})
      setShowErrors(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['activities'] }),
        qc.invalidateQueries({ queryKey: ['courses'] }),
      ])
    } finally {
      setSaving(false)
    }
  }

  // ── empty states ──
  // Both name a destination AND link it (UX-99): the mirror-image empty states
  // these replace each named one and went nowhere.
  if (direction === 'from-offering' && plans.length === 0) {
    return hostedInForm ? (
      <p className="text-xs text-muted-foreground">{t('noPlans')}</p>
    ) : (
      <EmptyLink text={t('noPlans')} action={t('noPlansAction')} href={'/offer/plans' as Route} />
    )
  }
  if (direction === 'from-plan' && offerings.length === 0) {
    return hostedInForm ? (
      <p className="text-xs text-muted-foreground">{t('noActivities')}</p>
    ) : (
      <EmptyLink
        text={t('noActivities')}
        action={t('noActivitiesAction')}
        href={'/offer/activities' as Route}
      />
    )
  }

  return (
    <div className="space-y-3">
      <SectionHeading
        level="sub"
        title={direction === 'from-offering' ? t('plansHeading') : t('includesHeading')}
        description={direction === 'from-offering' ? t('plansHint') : t('includesHint')}
      />

      {/* ── A TABLE, BECAUSE IT IS ALWAYS THE SAME QUESTION ────────────────
          Every row asks one question with the same four answers, so the
          answers are named ONCE, at the top, and each row is a line of radio
          cells under them. Repeating four labels on every row was most of the
          noise on this screen, and it hid the thing a studio actually wants to
          see: the COLUMN — "what is included in everything" read down the page
          rather than word by word across it.

          Wide content scrolls in its own container (never the page): a phone
          cannot fit a name plus four columns, and the name column stays put
          while the answers scroll so a row is never anonymous. */}
      <div className="overflow-x-auto rounded-md border">
      {/* `items-stretch` (the default) is load-bearing: a cell grows to the
          row's height, so the one column holding an input keeps the others
          filled beside it rather than leaving gaps in the tint. */}
      <div className="grid min-w-[36rem] grid-cols-[minmax(9rem,1fr)_repeat(4,5.75rem)]">
        {/* The header — the labels, once. It draws no bottom rule of its own:
            every row draws ONE continuous line above itself (see below), and a
            second line here would sit a hair off it.

            EACH LABEL IS ALSO THE COLUMN'S SWITCH. Once the answers are columns,
            "everything is included in this plan" is a column, and setting it row
            by row is work the shape of the screen already suggests should be one
            click. It only touches rows that can HONOUR the choice — an
            appointment has no gate to include, and skipping it silently is
            right: the alternative is refusing the whole gesture over a row the
            studio was not thinking about. Like every other edit here it lands as
            an unsaved draft, so it is reviewed before it is written. */}
        <div className="bg-muted/30 px-3 py-1.5" />
        {(['none', 'included', 'percent_off', 'fixed_price'] as const).map((c) => (
          <button
            key={c}
            type="button"
            disabled={!canEdit}
            onClick={() => setColumn(c)}
            title={
              canEdit
                ? t('setColumn', {
                    choice: c === 'none' ? t('choiceNone') : tb(`effect_${c}` as const),
                  })
                : c === 'none'
                  ? undefined
                  : tb(`effect_${c}_desc` as const)
            }
            className="bg-muted/30 px-1 py-1.5 text-center text-[11px] font-medium text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-default"
          >
            {c === 'none' ? t('choiceNone') : tb(`effect_${c}` as const)}
          </button>
        ))}
        {rows.map(({ key, off, plan: p }) => {
          const d = draftFor(key, off, p.id)
          // Which controls this offering can actually honour. An appointment has
          // no gate; a course honours one facet or the other depending on its
          // tier, and neither on a free or sign-in-only one.
          const facets = offeringFacets(off.target)
          const label = direction === 'from-offering' ? p.name : off.name
          // Everyone ELSE on this offering's ONE rate rule — named, because the
          // effect chosen here applies to them too. Read from the SAVED document
          // plus the draft, so a plan just ticked on is already counted.
          const others = plansSharingOfferingRate(off.target, p.id)
          const sharedWith = [...new Set(others)]
            .map((id) => plans.find((s) => s.id === id)?.name)
            .filter((n): n is string => !!n)
          const err = showErrors && d.edge.rate ? rateError(d.rate) : null
          const active = d.edge.access || d.edge.rate
          const choices = rowChoicesFor(off.target)
          const choice = choiceOf(d.edge, d.rate, facets)
          // THE SECOND QUESTION EXISTS ONLY WHEN IT HAS AN ANSWER. "Included,
          // and then a member rate" is meaningless on an unlimited plan — a
          // covered member never reaches the drop-in price, so the rate can
          // never apply. It becomes real the moment the plan carries a usage
          // limit ("3 a week"), because booking four sends the member to the
          // drop-in path, where the rate is what she pays. So the follow-up is
          // shown against the plan's ACTUAL limit and hidden otherwise, instead
          // of leaving a second control on screen that usually does nothing.
          const limit = resolveUsageLimit(p)
          const asksAfterAllowance = choice === 'included' && facets.access && facets.rate && !!limit
          const afterAllowance: 'full' | RateEffect = d.edge.rate ? d.rate.effect : 'full'
          // What this row DOES, in the studio's words rather than the model's —
          // and NAMING THE PRICE IT REDUCES, because "everyone else pays full
          // price" was not always true. A class's rate applies to its DROP-IN
          // price specifically: on a members-only class that sells no drop-in
          // there is no other price for it to reduce, and the rule sits there
          // doing nothing. The sentence now says which price it means, so the
          // studio can see that for itself.
          const isAppointment =
            off.target.kind === 'activity' && isAppointmentActivity(off.target.doc)
          const rateOnlyCopy =
            off.target.kind === 'course'
              ? t('outcomeRateOnlyCourse')
              : isAppointment
                ? t('outcomeRateOnlyAppointment')
                : t('outcomeRateOnlyClass')
          // Whether a price effect would have anything to reduce here, and the
          // one-line explanation shown on the muted options when it would not.
          const hasPriceToReduce = rateHasAPriceToApplyTo(off.target)
          const noPriceHint = isAppointment ? t('noPriceAppointment') : t('noPriceDropIn')
          const outcome =
            choice === 'none'
              ? null
              : choice === 'included'
                ? asksAfterAllowance && d.edge.rate
                  ? t('outcomeBoth', { count: limit!.count, per: t(`per_${limit!.per}`) })
                  : t('outcomeCovered')
                : rateOnlyCopy

          // The sub-row is drawn only when it has something to say, so an
          // untouched list stays exactly one line per row.
          const detail =
            outcome ||
            asksAfterAllowance ||
            err ||
            (sharedWith.length > 0 && d.edge.rate)

          return (
            // NO PER-ROW BORDER. A card around every ticked row turned a list of
            // twelve plans into twelve boxes, and the noise scaled with exactly
            // the studios that need this screen most. A live row is marked by a
            // tint and its accent bar, which reads at a glance without drawing a
            // box. `display: contents` lets one logical row place its cells
            // directly into the shared grid, so the columns line up across every
            // row without a table element.
            <div key={key} className="contents">
              {/* ONE LINE, DRAWN ONCE, ACROSS THE WHOLE ROW. Each cell used to
                  carry its own `border-t`, and the row's left accent bar pushed
                  the first of them inwards — so the rule arrived in pieces with
                  a notch at the start of every line. A single spanning element
                  cannot be interrupted by what the cells beside it do. */}
              <div className="col-span-5 border-t" />
              <div
                className={`flex min-w-0 items-center gap-2 px-3 py-2 text-sm ${
                  active ? 'border-l-2 border-l-primary bg-muted/40' : 'border-l-2 border-l-transparent'
                }`}
              >
                {direction === 'from-plan' && off.color !== undefined && (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: off.color || DEFAULT_ACCENT }}
                  />
                )}
                <span className="truncate">{label}</span>
                {direction === 'from-plan' && off.badge && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {off.badge}
                  </Badge>
                )}
              </div>

              {/* One cell per column, ALWAYS four, so the grid lines up across
                  rows of different kinds. A column this offering cannot honour
                  is a dash, not a disabled control: an appointment has no gate
                  (the price is the gate) and a subscription-tier course has no
                  price to discount — "not applicable here", which is a different
                  statement from "off". */}
              {(['none', 'included', 'percent_off', 'fixed_price'] as const).map((c) => {
                const offered = choices.includes(c)
                const on = offered && choice === c
                // MUTED, NOT ABSENT. A price effect with no price to reduce
                // would do nothing if chosen — a members-only class that sells
                // no drop-in has no second price, and an unpriced appointment is
                // already free. Hiding the option would leave the studio
                // wondering where it went; showing it live would let them
                // configure a rule that silently never applies. So it stays
                // visible, dimmed, and says why on hover. It is NOT disabled: a
                // studio mid-setup may well tick it before adding the price, and
                // the stored rule is correct the moment that price exists.
                const inert = offered && c !== 'none' && c !== 'included' && !hasPriceToReduce
                return (
                  <div
                    key={c}
                    className={`flex h-full flex-col items-center justify-center gap-1 px-1 py-2 ${
                      active ? 'bg-muted/40' : ''
                    }`}
                  >
                    {!offered ? (
                      <span className="text-xs text-muted-foreground/40" aria-hidden>
                        —
                      </span>
                    ) : (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${label} — ${
                          c === 'none' ? t('choiceNone') : tb(`effect_${c}` as const)
                        }`}
                        title={inert ? noPriceHint : undefined}
                        disabled={!canEdit}
                        onClick={() =>
                          setDraft(key, {
                            ...d,
                            // Switching AWAY from "Included" drops any
                            // after-allowance rate with it: that rate only ever
                            // meant "…and then this", so leaving it behind would
                            // store an answer to a question the studio just
                            // stopped asking.
                            edge: edgeForChoice(c, facets, false),
                            rate:
                              c === 'none' || c === 'included'
                                ? d.rate
                                : { ...d.rate, effect: c },
                          })
                        }
                        // Small, but unmistakable when chosen: at a glance down a
                        // column the answer has to read without comparing
                        // shades, which the ring does without the dot having to
                        // be large enough to crowd the row.
                        //
                        // SEMANTIC, NOT DECORATIVE — and a THREE-step scale,
                        // because there are three answers and not two: nothing
                        // (rose), reduced (amber), free (emerald). Amber earns
                        // its place by carrying information green would throw
                        // away: scanning a column, "included" and "20% off" are
                        // the difference between a plan that covers a class and
                        // one that merely discounts it.
                        //
                        // Muted, not an alarm palette: "not included" is an
                        // ordinary, correct answer for most pairings, not a
                        // fault to fix. And colour is never the only signal —
                        // the ring, the row tint and the sentence underneath all
                        // say the same thing, which is what keeps the table
                        // readable for anyone who cannot separate these hues.
                        className={`h-3.5 w-3.5 rounded-full border transition-colors disabled:opacity-50 ${
                          inert ? 'opacity-40' : ''
                        } ${
                          on
                            ? c === 'none'
                              ? 'border-rose-500 bg-rose-500 ring-2 ring-rose-500/25'
                              : c === 'included'
                                ? 'border-emerald-500 bg-emerald-500 ring-2 ring-emerald-500/25'
                                : 'border-amber-500 bg-amber-500 ring-2 ring-amber-500/25'
                            : 'border-muted-foreground/40 hover:border-foreground/70'
                        }`}
                      />
                    )}

                    {/* THE VALUE LIVES IN ITS OWN CELL, directly under the
                        answer it belongs to — read from the far side of the row
                        it belonged to nothing in particular. Keeping it inside
                        the cell (rather than in a second row of cells) is what
                        makes it impossible for the tint, the accent bar or the
                        column alignment to come apart around it. */}
                    {on && c === 'percent_off' && (
                      <span className="flex items-center gap-1">
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
                          className="h-7 w-12 px-1 text-center text-xs"
                          aria-label={tb('percentLabel')}
                        />
                        <span className="text-[10px] text-muted-foreground">%</span>
                      </span>
                    )}
                    {on && c === 'fixed_price' && (
                      <span className="flex items-center gap-1">
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
                          className="h-7 w-14 px-1 text-center text-xs"
                          aria-label={tb('amountLabel')}
                        />
                        <span className="text-[10px] text-muted-foreground">{currency}</span>
                      </span>
                    )}
                  </div>
                )
              })}

              {/* The row's own line: what it means, and the warning that names
                  who else this rate touches. It SPANS the grid, so nothing here
                  can shift the columns. */}
              {detail && (
                <div
                  className={`col-span-5 space-y-1.5 border-l-2 px-3 pb-2 text-xs ${
                    active ? 'border-l-primary bg-muted/40' : 'border-l-transparent'
                  }`}
                >
                  {outcome && <p className="text-muted-foreground">{outcome}</p>}

                  {/* The follow-up, asked only of a LIMITED plan (see above). */}
                  {asksAfterAllowance && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">
                        {t('afterAllowance', { count: limit!.count, per: t(`per_${limit!.per}`) })}
                      </span>
                      <Segmented
                        options={[
                          { value: 'full', label: t('afterAllowanceFull') },
                          ...offeringRateEffects(off.target).map((e) => ({
                            value: e,
                            label: tb(`effect_${e}` as const),
                          })),
                        ]}
                        value={afterAllowance}
                        disabled={!canEdit}
                        onChange={(next) =>
                          setDraft(key, {
                            ...d,
                            edge: { access: true, rate: next !== 'full' },
                            rate:
                              next === 'full' ? d.rate : { ...d.rate, effect: next as RateEffect },
                          })
                        }
                      />
                    </div>
                  )}

                  {err && (
                    <p className="text-destructive">
                      {tb(err === 'percent' ? 'percentValidation' : 'amountValidation')}
                    </p>
                  )}
                  {/* THE WARNING. Before the write, naming names. */}
                  {d.edge.rate && sharedWith.length > 0 && (
                    <p className="flex items-start gap-1.5 text-amber-600">
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

/**
 * An exclusive choice, rendered as one joined group.
 *
 * A RADIO, not checkboxes, because the answers really are mutually exclusive —
 * which is the whole correction here. Two independent checkboxes invited a
 * combination that is meaningless on most plans, and the studio had to work out
 * which pairs meant something. A group of buttons cannot express the impossible
 * state at all.
 */
function Segmented({
  options,
  value,
  disabled,
  onChange,
}: {
  options: { value: string; label: string; title?: string }[]
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div
      role="radiogroup"
      className="flex shrink-0 overflow-hidden rounded-md border text-xs"
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 transition-colors disabled:opacity-50 not-first:border-l ${
              on
                ? 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
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
