'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm, useFieldArray, type UseFormRegister, type UseFormSetValue } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { useInvalidateSetupChecklist } from '@/hooks/useSetupChecklist'
import { useTranslations } from 'next-intl'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  ACTIVITIES_COLLECTION,
  COURSES_COLLECTION,
  TEAMS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  INTRO_OFFER_MAX_PERIODS,
  isAppointmentActivity,
  introOfferProblem,
  introOfferSupport,
  introOffersOf,
  isRecurringRecurrence,
  resolveIntroOffer,
  resolveUsageLimit,
} from '@linyup/shared'
import type {
  SubscriptionType,
  SubscriptionPrice,
  SubscriptionIntroOffer,
  IntroOfferProblem,
  IntroOfferSupport,
} from '@linyup/shared'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Pencil, Copy, Trash2, ChevronUp, ChevronDown, Globe, GripVertical } from 'lucide-react'
import { SortableList, SortableItem } from '@/components/ui/sortable'
import { SubscriptionAutomationsSection } from '@/components/subscriptions/SubscriptionAutomationsSection'
import { ActivityPlanLinks, type Offering } from '@/components/offer/ActivityPlanLinks'
import { useActivities } from '@/hooks/useActivities'
import { useCourses } from '@/plugins/online-courses/hooks'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

const RECURRENCES = [
  'per_class',
  'one_time',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annual',
] as const

// Empty-string-tolerant numeric fields. An `<input type="number">` left blank
// yields `''`, and `z.coerce.number()` turns that into 0 — which `.positive()`
// then rejects, so the form refuses to save and says nothing about why. That is
// not hypothetical: it made an UNLIMITED credit pack (the normal case — leave
// the box empty) impossible to save at all.
//
// ZERO IS TREATED THE SAME WAY, and for the same reason: on every field this
// guards — credits, months included, purchase cap, usage limit, intro periods —
// zero and blank mean the identical thing ("none" / "no limit"). A stored 0 from
// a seed or an older document would otherwise reproduce the very bug above on a
// form the studio never typed a zero into.
const optionalPositiveInt = z.preprocess(
  (v) => (v === '' || v === undefined || v === null || Number(v) === 0 ? undefined : v),
  z.coerce.number().int().positive().optional()
)
const optionalNonNegativeAmount = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? undefined : v),
  z.coerce.number().min(0).optional()
)

const priceSchema = z.object({
  id: z.string(),
  amount: z.coerce.number().positive(),
  recurrence: z.enum(RECURRENCES),
  // Months of access granted by a one_time price ("2 months included"). On a
  // credit price, this is the pack's validity window instead.
  included_months: optionalPositiveInt,
  // Credit pack (one_time only): the purchase grants this many lesson credits.
  // BLANK MEANS UNLIMITED, which is why it must tolerate an empty string.
  credits: optionalPositiveInt,
  // How many times one contact may buy this price. Blank = unlimited.
  maxPurchasesPerContact: optionalPositiveInt,
  // This price's own intro offer ("first 3 months at 29, then the full price").
  // Per PRICE, not per plan: a plan's monthly and annual price are different
  // offers and a studio prices openers on both.
  introEnabled: z.boolean().optional(),
  introPeriods: optionalPositiveInt,
  introAmount: optionalNonNegativeAmount,
  label: z.string().max(40).optional(),
  active: z.boolean().optional(),
})

const subTypeSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  source: z.enum(['internal', 'aggregator']).default('internal'),
  active: z.boolean().optional(),
  public: z.boolean().optional(),
  checkout_contact_mode: z.enum(['off', 'minimal', 'full']).optional(),
  prices: z.array(priceSchema).optional(),
  // Usage limit ("up to N classes per period") — v1 single entry.
  limitEnabled: z.boolean().optional(),
  limitCount: optionalPositiveInt,
  limitPer: z.enum(['day', 'week', 'month']).optional(),
  // Aggregator-only: what the partner pays per attended visit.
  payoutPerVisit: optionalNonNegativeAmount,
})
type SubTypeData = z.infer<typeof subTypeSchema>

/**
 * The values a COPY starts from. Everything that describes the offer is carried
 * over; everything that is an identity or a promise to the public is not:
 *
 *  • `public` → false. A half-edited copy must not land on the pricing page.
 *  • every price gets a NEW id (they are client-generated uuids, referenced by
 *    member subscriptions and by payment rows).
 *  • no `id` / `order` / `created_at` — the create path below mints those, the
 *    same way it does for a brand-new type.
 *
 * The intro offer needs no remapping here any more: it rides ON its price row,
 * so a re-issued price id carries its own offer with it. The id-map dance this
 * used to do — and the "drop the offer if the price it named was not copied"
 * case it had to handle — was a cost of storing the offer away from its price.
 *
 * There is no Stripe object on a subscription type (prices are minted at
 * checkout from these figures), so nothing Stripe-shaped can be inherited here.
 */
function duplicateDefaults(source: SubscriptionType, copyName: string): SubTypeData {
  const base = emptyDefaults(source)
  return {
    ...base,
    name: copyName,
    public: false,
    prices: (base.prices ?? []).map((p) => ({ ...p, id: crypto.randomUUID() })),
  }
}

function emptyDefaults(editing: SubscriptionType | null): SubTypeData {
  const limit = resolveUsageLimit(editing ?? {})
  // Whichever shape the stored plan uses — the per-price list or the legacy
  // single offer — read through the one normaliser, keyed by price id.
  const introByPrice = new Map(introOffersOf(editing ?? {}).map((o) => [o.priceId, o]))
  return {
    name: editing?.name ?? '',
    description: editing?.description ?? '',
    source: editing?.source ?? 'internal',
    active: editing?.active ?? true,
    // New subscription types default to visible on the public pricing page;
    // existing ones keep whatever was saved.
    public: editing ? (editing.public ?? false) : true,
    checkout_contact_mode: editing?.checkout_contact_mode ?? 'minimal',
    limitEnabled: !!limit,
    limitCount: limit?.count,
    limitPer: limit?.per ?? 'week',
    payoutPerVisit: editing?.payoutPerVisit,
    prices: (editing?.prices ?? []).map((p) => {
      const intro = introByPrice.get(p.id)
      return {
        id: p.id,
        amount: p.amount,
        recurrence: p.recurrence,
        included_months: p.included_months,
        credits: p.credits,
        maxPurchasesPerContact: p.maxPurchasesPerContact,
        introEnabled: !!intro,
        introPeriods: intro?.periods,
        introAmount: intro?.amount,
        label: p.label ?? '',
        active: p.active ?? true,
      }
    }),
  }
}

// Linking an activity to a subscription is NOT done here any more. It lives in
// /offer/catalogue, which edits the same edge from either side through the one
// writer in @linyup/shared (`activityPlanEdgeUpdate`). This editor used to own a
// second copy of where that edge is stored — and the copies disagreed: it read
// only `accessRule`, so every appointment benefit looked unlinked, and an
// unlinked-looking tick got wiped on the next save (UX-69).

/**
 * A number field that keeps its UNIT visible while you type in it.
 *
 * The placeholder is not a label: it disappears at the first keystroke, and a
 * price row full of bare numbers ("2", "10", "1") cannot be read back at all.
 * The amount field has always carried its currency this way — this is the same
 * device, applied to the fields that were relying on a placeholder to explain
 * themselves. `aria-label` still carries the full name for screen readers, since
 * the suffix is an abbreviation.
 */
const SuffixInput = forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input> & { suffix: string }
>(function SuffixInput({ suffix, className, ...props }, ref) {
  return (
    <div className={cn('relative', className)}>
      {/* The right padding must clear the suffix, which is why the suffix is
          measured in the same place it is drawn rather than guessed at. */}
      <Input ref={ref} {...props} className="pr-[4.5rem] w-full" />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
})

/**
 * One price's intro offer ("first 3 months at 29, then the full price").
 *
 * Rendered INSIDE the price row, and only for a recurring price — a one-off or
 * per-class charge has no "then the full price" to return to, so there is
 * nothing to offer rather than a control to disable.
 */
function IntroOfferRow({
  index,
  state,
  currency,
  showError,
  register,
  setValue,
}: {
  index: number
  state: {
    eligible: boolean
    support: IntroOfferSupport
    enabled: boolean
    problem: IntroOfferProblem | null
  }
  currency: string
  showError: boolean
  register: UseFormRegister<SubTypeData>
  setValue: UseFormSetValue<SubTypeData>
}) {
  const t = useTranslations('TeamSettings')
  if (!state.eligible) return null

  return (
    <div className="border-t pt-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="accent-primary"
          checked={state.enabled}
          onChange={(e) => setValue(`prices.${index}.introEnabled`, e.target.checked)}
        />
        {t('subTypeIntro')}
      </label>
      {state.enabled && (
        <div className="mt-2 space-y-1.5 pl-5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('subTypeIntroAmount')}</Label>
              <div className="relative w-[140px]">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  {...register(`prices.${index}.introAmount`)}
                  className="h-8 pr-12 text-sm"
                  placeholder="0.00"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  {currency}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('subTypeIntroPeriods')}</Label>
              <Input
                type="number"
                step="1"
                min="1"
                max={INTRO_OFFER_MAX_PERIODS}
                // Locked to 1 on a weekly/fortnightly price — the note below
                // says why, rather than leaving a disabled control unexplained.
                disabled={state.support === 'first_only'}
                {...register(`prices.${index}.introPeriods`)}
                className="h-8 w-[110px] text-sm"
                placeholder="3"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('subTypeIntroFreeHint')}</p>
          {state.support === 'first_only' && (
            <p className="text-xs text-amber-600">{t('subTypeIntroWeeklyLimit')}</p>
          )}
          {showError && state.problem && (
            <p className="text-xs text-destructive">
              {/* `max` is passed for every reason, not just the one that uses
                  it — next-intl throws on a MISSING placeholder and ignores a
                  spare one, so the safe direction is to always supply it. */}
              {t(`subTypeIntroErr_${state.problem}` as Parameters<typeof t>[0], {
                max: INTRO_OFFER_MAX_PERIODS,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SubTypeDialog({
  open,
  onOpenChange,
  teamId,
  editing,
  duplicating,
  currency,
  nextOrder,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  editing: SubscriptionType | null
  /** The type a NEW one is being copied from — `editing` stays null so the
   *  submit takes the CREATE branch and nothing exists until it is saved. */
  duplicating: SubscriptionType | null
  currency: string
  /** Order assigned to a newly created type so it appends to the end. */
  nextOrder: number
  onSaved: () => void
}) {
  const t = useTranslations('TeamSettings')
  const tc = useTranslations('Contacts')
  const tCat = useTranslations('OfferCatalogue')
  const tCommon = useTranslations('Common')
  const tActivities = useTranslations('Activities')

  // The rows the edge editor offers. Built exactly as the catalogue builds them
  // — same shape, same collections — because it IS the same component reading
  // them. Courses are in for the same reason they are in the catalogue: a plan
  // can open one.
  const { data: activities = [] } = useActivities(teamId)
  const { data: courses = [] } = useCourses(teamId)
  // EVERY plan, not just the one being edited. The rate rule is ONE rule per
  // offering shared by all the plans on it, and the amber warning that says so
  // resolves its names from this list — passing `[editing]` filtered every other
  // plan to undefined, so the one surface where a studio edits a plan's own
  // links was the one surface where "this also changes Basic and Gold" never
  // appeared.
  const { data: allPlans = [] } = useSubscriptionTypes(teamId)
  const offerings: Offering[] = useMemo(
    () => [
      ...activities.map((a) => ({
        id: a.id,
        name: a.name,
        collection: ACTIVITIES_COLLECTION,
        color: a.color ?? '',
        badge: isAppointmentActivity(a) ? tCat('appointmentBadge') : undefined,
        target: { kind: 'activity' as const, doc: a },
      })),
      ...courses.map((c) => ({
        id: c.id,
        name: c.title,
        collection: COURSES_COLLECTION,
        badge: tCat('courseBadge'),
        target: { kind: 'course' as const, doc: c },
      })),
    ],
    [activities, courses, tCat]
  )

  const initialValues = () =>
    duplicating
      ? duplicateDefaults(duplicating, tCommon('copyName', { name: duplicating.name }))
      : emptyDefaults(editing)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { isSubmitting },
  } = useForm<SubTypeData>({
    resolver: zodResolver(subTypeSchema),
    defaultValues: initialValues(),
  })

  const { fields, append, remove, move } = useFieldArray({ control, name: 'prices' })

  useEffect(() => {
    if (open) {
      reset(initialValues())
      setShowIntroError(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, duplicating, reset])

  // ── Intro offers, ONE PER PRICE ────────────────────────────────────────────
  // The editor never invents a rule: it offers exactly what
  // `introOfferSupport` / `introOfferProblem` (@linyup/shared) allow, and the
  // checkout applies exactly what they allow. A weekly plan therefore shows a
  // locked "first period only" instead of a periods field that Stripe cannot
  // honour — `duration: 'repeating'` is measured in MONTHS and nothing else, so
  // "the first 3 weeks" is not expressible and must not be offered.
  //
  // The offer now lives ON its price row, which removed the price CHOOSER this
  // section used to need, the auto-pick effect behind it, and the whole class of
  // question "which of my prices did I put the offer on?".
  const watchedPrices = watch('prices') ?? []

  /** The offer typed into one price row, resolved against that row's own price:
   *  what Stripe can express for it, the draft, and the shared verdict. */
  const introRowState = (i: number) => {
    const p = watchedPrices[i]
    const recurrence = p?.recurrence
    const eligible = !!p && p.active !== false && isRecurringRecurrence(recurrence)
    const support = eligible ? introOfferSupport(recurrence) : 'none'
    const enabled = eligible && (p?.introEnabled ?? false)
    // ── NUMBERS, not the strings the form holds ──────────────────────────────
    // `watch()` returns RAW form state: an `<input type="number">` registered
    // without `valueAsNumber` yields a STRING, and zod's coercion only runs at
    // validation. Checking the raw value would call a perfectly good "79"
    // not-a-number and refuse every save.
    const periods = support === 'first_only' ? 1 : Number(p?.introPeriods ?? 1) || 1
    const amountRaw = p?.introAmount as unknown
    // A BLANK field is not zero. `Number('')` is 0, which would quietly turn "I
    // haven't typed the price yet" into "the first months are free".
    const amount =
      amountRaw === '' || amountRaw === undefined || amountRaw === null ? NaN : Number(amountRaw)
    const draft: SubscriptionIntroOffer | null = enabled
      ? { priceId: p!.id, periods, amount }
      : null
    const problem = draft
      ? introOfferProblem(draft, { amount: Number(p!.amount), recurrence: p!.recurrence })
      : null
    return { eligible, support, enabled, draft, problem }
  }

  // Every sound offer currently typed, and whether ANY row is unsound. The save
  // is refused on the latter — an unsellable offer is worse than none, because
  // `resolveIntroOffer` returns null for it and the public card would advertise
  // nothing while the studio believed it had launched a promotion.
  const introDrafts = watchedPrices
    .map((_, i) => introRowState(i))
    .filter((s) => s.draft && !s.problem)
    .map((s) => s.draft!)
  const hasIntroProblem = watchedPrices.some((_, i) => introRowState(i).problem)
  const [showIntroError, setShowIntroError] = useState(false)
  // The linked-plans editor holds ticks this form's Save does not write — see
  // the note on its mount below.
  const [planLinksDirty, setPlanLinksDirty] = useState(false)

  const source = watch('source')
  const active = watch('active') ?? true
  const isPublic = watch('public') ?? false
  const contactMode = watch('checkout_contact_mode') ?? 'minimal'
  const limitEnabled = watch('limitEnabled') ?? false
  const limitPer = watch('limitPer') ?? 'week'

  async function onSubmit(data: SubTypeData) {
    // Refuse the save and name the rule on the row that broke it.
    if (hasIntroProblem) {
      setShowIntroError(true)
      return
    }
    const prices = (data.prices ?? []).map((p) => {
      const entry: SubscriptionPrice = {
        id: p.id,
        amount: p.amount,
        recurrence: p.recurrence,
        active: p.active ?? true,
      }
      if (p.label?.trim()) entry.label = p.label.trim()
      if (p.recurrence === 'one_time' && p.included_months) {
        entry.included_months = p.included_months
      }
      // Credit packs are one_time only; omit credits: 0/undefined (don't write it).
      if (p.recurrence === 'one_time' && p.credits) {
        entry.credits = p.credits
      }
      // A purchase cap governs one-time prices only — `resolvePlanPurchaseCap`
      // ignores it anywhere else, so writing it there would be inert data.
      if (p.recurrence === 'one_time' && p.maxPurchasesPerContact) {
        entry.maxPurchasesPerContact = p.maxPurchasesPerContact
      }
      return entry
    })
    const payload = {
      name: data.name,
      description: data.description || null,
      source: data.source,
      active: data.active ?? true,
      public: data.public ?? false,
      checkout_contact_mode: data.checkout_contact_mode ?? 'minimal',
      prices,
      // Usage limit: write when enabled with a valid count/period, clear when
      // disabled (only meaningful on an update — a new doc simply omits it).
      ...(data.limitEnabled && data.limitCount && data.limitPer
        ? { limits: [{ count: data.limitCount, per: data.limitPer }] }
        : editing?.limits?.length
          ? { limits: deleteField() }
          : {}),
      // Payout per visit: aggregator types only.
      ...(data.source === 'aggregator' && typeof data.payoutPerVisit === 'number'
        ? { payoutPerVisit: data.payoutPerVisit }
        : editing?.payoutPerVisit !== undefined
          ? { payoutPerVisit: deleteField() }
          : {}),
      // Intro offers: the sound ones, one per price (the guard above has already
      // refused the save if any row is unsound); the key is cleared when none
      // remain. The LEGACY single-offer field is deleted in the same update —
      // this write is where a document migrates forward, so the two shapes can
      // never both stand and `introOffersOf` never has to arbitrate on real data.
      ...(introDrafts.length > 0
        ? { introOffers: introDrafts }
        : editing?.introOffers?.length
          ? { introOffers: deleteField() }
          : {}),
      ...(editing?.introOffer ? { introOffer: deleteField() } : {}),
    }
    if (editing) {
      await updateDoc(
        doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, editing.id),
        payload
      )
    } else {
      await addDoc(
        collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION),
        {
          ...payload,
          order: nextOrder,
          created_at: serverTimestamp(),
        }
      )
      // NOTHING is linked here. What a plan opens is the edge editor's, and it
      // needs an id to write against — which is why the dialog shows "save
      // first" until this create has run. Reopening the plan is the next step,
      // not a fallback.
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('editSubscriptionType')
              : duplicating
                ? tCommon('duplicate')
                : t('addSubscriptionType')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>{t('fieldSubTypeName')}</Label>
            <Input {...register('name')} placeholder="e.g. Monthly pass, Fitpass" />
          </div>
          <div className="space-y-1">
            <Label>{t('fieldSubTypeDesc')}</Label>
            <Textarea
              {...register('description')}
              rows={2}
              placeholder="Optional context — e.g. Unlimited access, valid for the whole month"
              className="resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('fieldSubTypeSource')}</Label>
            <div className="flex gap-2">
              {(['internal', 'aggregator'] as const).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setValue('source', val)}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors text-left ${
                    source === val
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:border-foreground/30'
                  }`}
                >
                  <p className="font-medium">
                    {t(val === 'internal' ? 'subTypeSourceInternal' : 'subTypeSourceAggregator')}
                  </p>
                  <p className="text-xs font-normal mt-0.5 text-muted-foreground">
                    {val === 'internal'
                      ? t('subTypeSourceInternalDesc')
                      : t('subTypeSourceAggregatorDesc')}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {source === 'aggregator' && (
            <div className="space-y-1">
              <Label>{t('subTypePayoutPerVisit')}</Label>
              <div className="relative max-w-[200px]">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('payoutPerVisit')}
                  className="pr-12"
                  placeholder="0.00"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  {currency}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t('subTypePayoutPerVisitDesc')}</p>
            </div>
          )}

          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <Label>{t('subTypeActive')}</Label>
              <p className="text-xs text-muted-foreground">{t('subTypeActiveDesc')}</p>
            </div>
            <Switch checked={active} onCheckedChange={(v) => setValue('active', v)} />
          </div>

          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {t('subTypePublic')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('subTypePublicDesc')}</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={(v) => setValue('public', v)} />
          </div>

          {isPublic && (
            <div className="space-y-1.5">
              <Label>{t('subTypeCheckoutContact')}</Label>
              {/* Selectable option cards — the same shape the activity editor's
                  "who can book" uses, and for the same reason: each option's
                  explanation belongs INSIDE the box it explains. These three
                  used to be bare pills with all three explanations concatenated
                  into one sentence underneath, which the reader had to map back
                  to the buttons by position — and which no translator could keep
                  in the button order, being a single string. */}
              <div className="grid gap-2 lg:grid-cols-3">
                {(['off', 'minimal', 'full'] as const).map((val) => (
                  <label
                    key={val}
                    className={`flex items-start gap-2 cursor-pointer text-sm rounded-lg border p-2.5 transition-colors ${
                      contactMode === val ? 'border-primary bg-primary/5' : 'hover:border-foreground/30'
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-0.5 accent-primary"
                      checked={contactMode === val}
                      onChange={() => setValue('checkout_contact_mode', val)}
                    />
                    <span>
                      <span className="font-medium">
                        {t(`subTypeContactMode_${val}` as Parameters<typeof t>[0])}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`subTypeContactMode_${val}_desc` as Parameters<typeof t>[0])}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Pricing (optional) — kept secondary so the simple flow stays one-field */}
          <FormSection
            title={t('subTypePricing')}
            description={t('subTypePricingDesc')}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    id: crypto.randomUUID(),
                    amount: 0,
                    recurrence: 'monthly',
                    label: '',
                    active: true,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('subTypeAddPrice')}
              </Button>
            }
          >
            {fields.length > 0 && (
              <div className="space-y-2 pt-1">
                {fields.map((field, i) => (
                  <div key={field.id} className="rounded-md border bg-card p-2.5 space-y-2">
                    {/* WRAPS, and the amount field may SHRINK. This row is an
                        amount, a recurrence select (130px) and sometimes a
                        second 130px input — a min-content width the dialog
                        cannot always give it. `DialogBody` is `overflow-y-auto`,
                        and CSS promotes overflow-x to `auto` alongside it, so a
                        child one pixel too wide put a horizontal scrollbar under
                        the whole form. Fixed by letting the row wrap and the
                        flexible child shrink — never by clipping the body,
                        which would hide a control instead of moving it. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative min-w-[8rem] flex-1">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...register(`prices.${i}.amount`)}
                          className="pr-12"
                          placeholder="0.00"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                          {currency}
                        </span>
                      </div>
                      <Select
                        value={watch(`prices.${i}.recurrence`)}
                        onValueChange={(v) =>
                          setValue(
                            `prices.${i}.recurrence`,
                            v as (typeof RECURRENCES)[number]
                          )
                        }
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {tc(`recurrence_${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* THE UNIT STAYS ON SCREEN once a value is typed. These
                          used to carry their meaning in the PLACEHOLDER, which
                          vanishes at the first keystroke and leaves a bare
                          number nobody can read back — is "2" two months, two
                          credits, or two of something else? Same suffix
                          treatment as the currency on the amount field beside
                          it, so the row reads as a sentence either way. */}
                      {watch(`prices.${i}.recurrence`) === 'one_time' && (
                        <SuffixInput
                          suffix={t('subTypeIncludedMonthsSuffix')}
                          type="number"
                          step="1"
                          min="1"
                          className="w-[150px]"
                          aria-label={t('subTypeIncludedMonths')}
                          {...register(`prices.${i}.included_months`)}
                        />
                      )}
                    </div>
                    {watch(`prices.${i}.recurrence`) === 'one_time' && (
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                        <div className="space-y-1">
                          <SuffixInput
                            suffix={t('subTypeCreditsSuffix')}
                            type="number"
                            step="1"
                            min="1"
                            className="w-[170px] h-8 text-sm"
                            aria-label={t('subTypeCreditsPlaceholder')}
                            {...register(`prices.${i}.credits`)}
                          />
                          <p className="text-xs text-muted-foreground">{t('subTypeCreditsHelp')}</p>
                        </div>
                        {/* How many times ONE person may buy this — the "our
                            2-month intro is once per customer" rule. Blank =
                            unlimited, which is why it is a plain optional
                            field and not a switch with a number behind it. */}
                        <div className="space-y-1">
                          <SuffixInput
                            suffix={t('subTypeMaxPurchasesSuffix')}
                            type="number"
                            step="1"
                            min="1"
                            className="w-[170px] h-8 text-sm"
                            placeholder={t('subTypeMaxPurchasesUnlimited')}
                            aria-label={t('subTypeMaxPurchases')}
                            {...register(`prices.${i}.maxPurchasesPerContact`)}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('subTypeMaxPurchasesHelp')}
                          </p>
                        </div>
                      </div>
                    )}
                    {/* This price's own intro offer. It sits INSIDE the row
                        because it is a fact about this price — a plan may open
                        its monthly and its annual price differently, and when
                        the offer lived at plan level only one of them could
                        have one. */}
                    <IntroOfferRow
                      index={i}
                      state={introRowState(i)}
                      currency={currency}
                      showError={showIntroError}
                      register={register}
                      setValue={setValue}
                    />
                    <div className="flex items-center gap-2">
                      <Input
                        {...register(`prices.${i}.label`)}
                        placeholder={t('subTypePriceLabelPlaceholder')}
                        className="flex-1 h-8 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => move(i, i - 1)}
                        disabled={i === 0}
                        className="p-1 rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                        aria-label={t('subTypePriceMoveUp')}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, i + 1)}
                        disabled={i === fields.length - 1}
                        className="p-1 rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                        aria-label={t('subTypePriceMoveDown')}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <Switch
                        checked={watch(`prices.${i}.active`) ?? true}
                        onCheckedChange={(v) => setValue(`prices.${i}.active`, v)}
                      />
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                        aria-label={t('subTypePriceRemove')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FormSection>

          {/* Usage limit — caps CLASS bookings covered by this subscription
              per calendar day/week/month. Once spent, the drop-in price still
              applies (member rate); credits and appointments are unaffected. */}
          <FormSection
            title={t('subTypeUsageLimit')}
            description={t('subTypeUsageLimitDesc')}
            action={
              <Switch
                checked={limitEnabled}
                onCheckedChange={(v) => setValue('limitEnabled', v)}
              />
            }
          >
            {limitEnabled && (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  step="1"
                  min="1"
                  {...register('limitCount')}
                  className="w-24"
                  placeholder="3"
                />
                <Select
                  value={limitPer}
                  onValueChange={(v) => setValue('limitPer', v as 'day' | 'week' | 'month')}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">{t('subTypeLimitPeriodDay')}</SelectItem>
                    <SelectItem value="week">{t('subTypeLimitPeriodWeek')}</SelectItem>
                    <SelectItem value="month">{t('subTypeLimitPeriodMonth')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </FormSection>

          {/* ── WHAT THIS PLAN OPENS, EDITED HERE ─────────────────────────
              For one release this was a LINK to the catalogue, and the link was
              the wrong lesson drawn from a real bug. The bug (UX-69) was TWO
              WRITERS: this dialog had its own copy of where the activity↔plan
              edge is stored, it read only `accessRule`, so every appointment
              benefit looked unlinked and an unlinked-looking tick was wiped on
              the next save. Removing the second writer was right. Removing the
              CONTROL was not — it sent a studio away from a half-filled form to
              another page to answer the most obvious question a plan raises.

              So the control is back and there is still exactly one writer: this
              mounts `ActivityPlanLinks`, the same component the catalogue
              mounts, in its `from-plan` direction. Same rows, same validation,
              same `offeringPlanEdgeUpdate` transaction, same shared-rate
              warning. There is nothing here for the two to disagree about
              because there is no second implementation to disagree with. */}
          {editing ? (
            <FormSection>
              <ActivityPlanLinks
                direction="from-plan"
                plan={editing}
                offerings={offerings}
                plans={allPlans}
                currency={currency}
                canEdit
                // This editor sits INSIDE a form that holds unsaved input, and
                // it writes the SAME document that form's Save writes. Both
                // consequences were unhandled here: the empty state linked away
                // from a half-filled dialog (discarding it), and unsaved ticks
                // were silently dropped by a Save that writes the STORED links.
                hostedInForm
                onDirtyChange={setPlanLinksDirty}
              />
            </FormSection>
          ) : (
            /* A plan that does not exist yet has no id to hang an edge on. Say
               that, rather than rendering an inert list of activities whose
               ticks would be discarded on save. An EMPTY STATE keeps its box —
               it is an aside, not the next setting. */
            <FormSection title={t('subTypeActivitiesLabel')}>
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                {t('subTypeActivitiesAfterSave')}
              </p>
            </FormSection>
          )}

          {/* Automations referencing this subscription + a quick create shortcut */}
          {editing && (
            <FormSection>
              <SubscriptionAutomationsSection teamId={teamId} subscriptionType={editing} />
            </FormSection>
          )}
          </DialogBody>

          <DialogFooter className={planLinksDirty ? 'sm:justify-between' : undefined}>
            {/* Says what this Save will DISCARD, beside the button that would
                do it — the same warning the activity dialog carries, for the
                same reason: this form writes the STORED links, so a tick left
                unsaved in the box above is lost without a word. */}
            {planLinksDirty && (
              <p className="text-xs text-amber-600">{tActivities('planLinksUnsaved')}</p>
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('saving') : t('save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface SubscriptionTypesManagerHandle {
  openAdd: () => void
}

export const SubscriptionTypesManager = forwardRef<
  SubscriptionTypesManagerHandle,
  { teamId: string; currency?: string }
>(function SubscriptionTypesManager({ teamId, currency = 'CHF' }, ref) {
  const t = useTranslations('TeamSettings')
  const tc = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { data: types = [], isLoading } = useSubscriptionTypes(teamId)
  const editParam = useSearchParams().get('edit')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SubscriptionType | null>(null)
  const [duplicating, setDuplicating] = useState<SubscriptionType | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // The setup checklist's "set a price" step counts subscription types, so both
  // queries have to look again — the list's own, and the checklist's.
  const invalidateSetupChecklist = useInvalidateSetupChecklist()
  const invalidate = () => {
    void invalidateSetupChecklist()
    return qc.invalidateQueries({ queryKey: ['subscription-types', teamId] })
  }

  const openAdd = () => {
    setEditing(null)
    setDuplicating(null)
    setDialogOpen(true)
  }

  // Let the page header own the primary "New type" action.
  useImperativeHandle(ref, () => ({ openAdd }))

  // ── arriving from the catalogue's Edit button (?edit=<id>) ──
  // The types load async, so this cannot be a lazy initializer the way the
  // "new" param is: there is nothing to find on first render. It runs when the
  // data arrives, and the ref makes it run ONCE — without that, closing the
  // dialog while the param is still in the URL would immediately reopen it.
  const consumedEditParam = useRef(false)
  useEffect(() => {
    if (consumedEditParam.current || !editParam || types.length === 0) return
    const target = types.find((st) => st.id === editParam)
    consumedEditParam.current = true
    if (target) openEdit(target)
  }, [editParam, types])

  const openEdit = (st: SubscriptionType) => {
    setDuplicating(null)
    setEditing(st)
    setDialogOpen(true)
  }

  const openDuplicate = (st: SubscriptionType) => {
    setEditing(null)
    setDuplicating(st)
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, id))
    setDeleting(null)
    invalidate()
  }

  // Drag-and-drop reorder. Persists `order = position` for the whole list in one
  // batch (normalizes any docs that never had an explicit order). The list is
  // already sorted by `compareSubscriptionTypes` via the hook.
  const reorder = async (from: number, to: number) => {
    if (from === to) return
    const next = [...types]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    const batch = writeBatch(db)
    next.forEach((st, i) => {
      if (st.order !== i) {
        batch.update(doc(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION, st.id), {
          order: i,
        })
      }
    })
    await batch.commit()
    invalidate()
  }

  if (isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    )

  return (
    <div className="space-y-4">
      {types.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {t('noSubscriptionTypes')}
        </div>
      ) : (
        <SortableList ids={types.map((st) => st.id)} onReorder={reorder}>
          <div className="space-y-2">
            {types.map((st) => (
              <SortableItem key={st.id} id={st.id}>
                {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                  <div
                    ref={setNodeRef}
                    style={style}
                    className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
                      isDragging ? 'shadow-lg' : ''
                    }`}
                  >
                    <button
                      type="button"
                      {...attributes}
                      {...listeners}
                      className="p-1 -ml-1 rounded text-muted-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing touch-none"
                      aria-label={t('subTypeReorder')}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{st.name}</p>
                        <Badge
                          variant={st.source === 'aggregator' ? 'secondary' : 'outline'}
                          className="text-xs"
                        >
                          {t(
                            st.source === 'aggregator'
                              ? 'subTypeSourceAggregator'
                              : 'subTypeSourceInternal'
                          )}
                        </Badge>
                        {st.active === false && (
                          <Badge variant="outline" className="text-xs">
                            {t('subTypeInactive')}
                          </Badge>
                        )}
                        {st.public && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Globe className="h-3 w-3" />
                            {t('subTypePublicBadge')}
                          </Badge>
                        )}
                        {/* Only when the offer actually RESOLVES — the same
                            question the public card asks. A badge on an offer
                            the checkout would ignore is the exact false
                            reassurance this feature must not give. */}
                        {(st.prices ?? []).some((p) => resolveIntroOffer(st, p.id)) && (
                          <Badge variant="outline" className="text-xs">
                            {t('subTypeIntroBadge')}
                          </Badge>
                        )}
                      </div>
                      {st.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {st.description}
                        </p>
                      )}
                      {(st.prices?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {st.prices!.filter((p) => p.active !== false).map((p) => (
                            <span
                              key={p.id}
                              className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium"
                            >
                              {formatCurrency(p.amount, currency)} · {tc(`recurrence_${p.recurrence}`)}
                              {!!p.credits && (
                                <>
                                  {' '}
                                  ·{' '}
                                  <span className="text-primary">
                                    {t('subTypeCreditsBadge', { count: p.credits })}
                                  </span>
                                </>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => openEdit(st)}
                      className="p-1.5 rounded hover:bg-muted transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => openDuplicate(st)}
                      title={tCommon('duplicate')}
                      className="p-1.5 rounded hover:bg-muted transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => setDeleting(st.id)}
                      className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableList>
      )}

      <SubTypeDialog
        key={editing?.id ?? (duplicating ? `copy-${duplicating.id}` : 'new')}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        teamId={teamId}
        editing={editing}
        duplicating={duplicating}
        currency={currency}
        nextOrder={types.length}
        onSaved={invalidate}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteSubType')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-1">
            {t('deleteSubTypeConfirm', { name: types.find((s) => s.id === deleting)?.name ?? '' })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleting && handleDelete(deleting)}>
              {t('deleteSubType')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})
