'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
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
  TEAMS_COLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  INTRO_OFFER_MAX_PERIODS,
  introOfferProblem,
  introOfferSupport,
  isRecurringRecurrence,
  resolveIntroOffer,
  resolveUsageLimit,
} from '@linyup/shared'
import type {
  SubscriptionType,
  SubscriptionPrice,
  SubscriptionIntroOffer,
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Pencil, Copy, Trash2, ChevronUp, ChevronDown, Globe, GripVertical } from 'lucide-react'
import { SortableList, SortableItem } from '@/components/ui/sortable'
import { SubscriptionAutomationsSection } from '@/components/subscriptions/SubscriptionAutomationsSection'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { formatCurrency } from '@/lib/format'

const RECURRENCES = [
  'per_class',
  'one_time',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annual',
] as const

const priceSchema = z.object({
  id: z.string(),
  amount: z.coerce.number().positive(),
  recurrence: z.enum(RECURRENCES),
  // Months of membership granted by a one_time price (e.g. intro offer). On a
  // credit price, this is the pack's validity window.
  included_months: z.coerce.number().int().positive().optional(),
  // Credit pack (one_time only): the purchase grants this many lesson credits.
  credits: z.coerce.number().int().positive().optional(),
  label: z.string().max(40).optional(),
  active: z.boolean().optional(),
})

// Empty-string-tolerant numeric fields — these live outside a useFieldArray
// row, so the input may be blank while its sibling toggle is off.
const optionalPositiveInt = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? undefined : v),
  z.coerce.number().int().positive().optional()
)
const optionalNonNegativeAmount = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? undefined : v),
  z.coerce.number().min(0).optional()
)

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
  // Intro offer — first N periods of ONE recurring price at a reduced or zero
  // amount, then the full price. Validated by the SHARED `introOfferProblem`
  // (not by zod), because the rules are Stripe's and the server enforces the
  // same ones: see @linyup/shared/utils/introOffer.ts.
  introEnabled: z.boolean().optional(),
  introPriceId: z.string().optional(),
  introPeriods: optionalPositiveInt,
  introAmount: optionalNonNegativeAmount,
})
type SubTypeData = z.infer<typeof subTypeSchema>

/**
 * The values a COPY starts from. Everything that describes the offer is carried
 * over; everything that is an identity or a promise to the public is not:
 *
 *  • `public` → false. A half-edited copy must not land on the pricing page.
 *  • every price gets a NEW id (they are client-generated uuids, referenced by
 *    `introOffer.priceId`, by member subscriptions and by payment rows) — and
 *    the intro offer is re-pointed at the copy's own price, or dropped if the
 *    one it named was not copied.
 *  • no `id` / `order` / `created_at` — the create path below mints those, the
 *    same way it does for a brand-new type.
 *
 * There is no Stripe object on a subscription type (prices are minted at
 * checkout from these figures), so nothing Stripe-shaped can be inherited here.
 */
function duplicateDefaults(source: SubscriptionType, copyName: string): SubTypeData {
  const base = emptyDefaults(source)
  const idMap = new Map<string, string>()
  const prices = (base.prices ?? []).map((p) => {
    const nextId = crypto.randomUUID()
    idMap.set(p.id, nextId)
    return { ...p, id: nextId }
  })
  const introPriceId = base.introPriceId ? idMap.get(base.introPriceId) : undefined
  return {
    ...base,
    name: copyName,
    public: false,
    prices,
    introEnabled: base.introEnabled && !!introPriceId,
    introPriceId: introPriceId ?? '',
  }
}

function emptyDefaults(editing: SubscriptionType | null): SubTypeData {
  const limit = resolveUsageLimit(editing ?? {})
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
    introEnabled: !!editing?.introOffer,
    introPriceId: editing?.introOffer?.priceId ?? '',
    introPeriods: editing?.introOffer?.periods,
    introAmount: editing?.introOffer?.amount,
    prices: (editing?.prices ?? []).map((p) => ({
      id: p.id,
      amount: p.amount,
      recurrence: p.recurrence,
      included_months: p.included_months,
      credits: p.credits,
      label: p.label ?? '',
      active: p.active ?? true,
    })),
  }
}

// Linking an activity to a subscription is NOT done here any more. It lives in
// /offer/catalogue, which edits the same edge from either side through the one
// writer in @linyup/shared (`activityPlanEdgeUpdate`). This editor used to own a
// second copy of where that edge is stored — and the copies disagreed: it read
// only `accessRule`, so every appointment benefit looked unlinked, and an
// unlinked-looking tick got wiped on the next save (UX-69).

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
  const tCommon = useTranslations('Common')

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

  // ── Intro offer ────────────────────────────────────────────────────────────
  // The editor never invents a rule: it offers exactly what
  // `introOfferSupport` / `introOfferProblem` (@linyup/shared) allow, and the
  // checkout applies exactly what they allow. A weekly plan therefore shows a
  // locked "first period only" instead of a periods field that Stripe cannot
  // honour — `duration: 'repeating'` is measured in MONTHS and nothing else, so
  // "the first 3 weeks" is not expressible and must not be offered.
  const introEnabled = watch('introEnabled') ?? false
  const introPriceId = watch('introPriceId') ?? ''
  const watchedPrices = watch('prices') ?? []
  // Only a RECURRING price can carry one: a per-class or one-off charge has no
  // "then the full price" to return to.
  const introEligiblePrices = watchedPrices.filter(
    (p) => p.active !== false && isRecurringRecurrence(p.recurrence)
  )
  const introPrice = introEligiblePrices.find((p) => p.id === introPriceId) ?? null
  const introSupport = introPrice ? introOfferSupport(introPrice.recurrence) : 'none'
  // ── NUMBERS, not the strings the form holds ────────────────────────────────
  // `watch()` returns RAW form state: a `<input type="number">` registered
  // without `valueAsNumber` yields a STRING, and zod's coercion only runs at
  // validation. Checking the raw value against `introOfferProblem` would call a
  // perfectly good "79" not-a-number and refuse every save.
  const introPeriods = Number(watch('introPeriods') ?? 1) || 1
  const introAmountRaw = watch('introAmount') as unknown
  // A BLANK field is not zero. `Number('')` is 0, which would quietly turn "I
  // haven't typed the price yet" into "the first months are free".
  const introAmount =
    introAmountRaw === '' || introAmountRaw === undefined || introAmountRaw === null
      ? NaN
      : Number(introAmountRaw)
  const introPriceForCheck = introPrice
    ? { amount: Number(introPrice.amount), recurrence: introPrice.recurrence }
    : null

  // Pick the only eligible price automatically — a chooser with one option is a
  // question with one answer.
  useEffect(() => {
    if (!introEnabled) return
    if (introPrice) return
    if (introEligiblePrices.length > 0) setValue('introPriceId', introEligiblePrices[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introEnabled, introPriceId, introEligiblePrices.length])

  // A weekly/biweekly plan can only discount its FIRST period, so hold the
  // stored value at 1 rather than letting a 3 sit in a hidden field and be saved.
  useEffect(() => {
    if (introSupport === 'first_only' && introPeriods !== 1) setValue('introPeriods', 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introSupport, introPeriods])

  /** The shared verdict on what is currently typed, or null when it is sound.
   *  Same function the server calls — the editor cannot save an offer the
   *  checkout would refuse, and cannot refuse one the checkout would apply. */
  const introDraft: SubscriptionIntroOffer | null = introEnabled
    ? {
        priceId: introPriceId,
        periods: introSupport === 'first_only' ? 1 : introPeriods,
        amount: introAmount,
      }
    : null
  const introProblem = introDraft ? introOfferProblem(introDraft, introPriceForCheck) : null
  const [showIntroError, setShowIntroError] = useState(false)

  const source = watch('source')
  const active = watch('active') ?? true
  const isPublic = watch('public') ?? false
  const contactMode = watch('checkout_contact_mode') ?? 'minimal'
  const limitEnabled = watch('limitEnabled') ?? false
  const limitPer = watch('limitPer') ?? 'week'

  async function onSubmit(data: SubTypeData) {
    // An unsellable intro offer is worse than none: `resolveIntroOffer` returns
    // null for it, so the public card would advertise nothing while the studio
    // believed it had launched a promotion. Refuse the save and name the rule.
    if (introProblem) {
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
      // Intro offer: written only when it is switched on AND sound (the guard
      // above has already refused the save otherwise); cleared when switched off.
      ...(introDraft && !introProblem
        ? { introOffer: introDraft }
        : editing?.introOffer
          ? { introOffer: deleteField() }
          : {}),
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
      // Link the selected activities to the freshly-created type. If this write
      // fails the type still exists (just unlinked) — the links can be added by
      // reopening it, so we don't roll the creation back.
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
              <div className="flex gap-2">
                {(['off', 'minimal', 'full'] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setValue('checkout_contact_mode', val)}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      contactMode === val
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:border-foreground/30'
                    }`}
                  >
                    {t(`subTypeContactMode_${val}` as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('subTypeCheckoutContactDesc')}</p>
            </div>
          )}

          {/* Pricing (optional) — kept secondary so the simple flow stays one-field */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('subTypePricing')}</Label>
                <p className="text-xs text-muted-foreground">{t('subTypePricingDesc')}</p>
              </div>
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
            </div>

            {fields.length > 0 && (
              <div className="space-y-2 pt-1">
                {fields.map((field, i) => (
                  <div key={field.id} className="rounded-md border bg-card p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
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
                      {watch(`prices.${i}.recurrence`) === 'one_time' && (
                        <Input
                          type="number"
                          step="1"
                          min="1"
                          {...register(`prices.${i}.included_months`)}
                          className="w-[130px]"
                          placeholder={t('subTypeIncludedMonths')}
                        />
                      )}
                    </div>
                    {watch(`prices.${i}.recurrence`) === 'one_time' && (
                      <div className="space-y-1">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          {...register(`prices.${i}.credits`)}
                          className="w-[160px] h-8 text-sm"
                          placeholder={t('subTypeCreditsPlaceholder')}
                        />
                        <p className="text-xs text-muted-foreground">{t('subTypeCreditsHelp')}</p>
                      </div>
                    )}
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
          </div>

          {/* Intro offer — the first N periods of ONE recurring price at a
              reduced or zero amount, then the full price automatically. It is a
              Stripe COUPON on the checkout, never a lower recurring price, and
              the controls below offer only what Stripe can express. */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('subTypeIntro')}</Label>
                <p className="text-xs text-muted-foreground">{t('subTypeIntroDesc')}</p>
              </div>
              <Switch
                checked={introEnabled}
                disabled={introEligiblePrices.length === 0}
                onCheckedChange={(v) => {
                  setValue('introEnabled', v)
                  if (!v) setShowIntroError(false)
                }}
              />
            </div>
            {introEligiblePrices.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('subTypeIntroNoRecurring')}</p>
            ) : (
              introEnabled && (
                <div className="space-y-2">
                  {introEligiblePrices.length > 1 && (
                    <div className="space-y-1">
                      <Label className="text-xs">{t('subTypeIntroPrice')}</Label>
                      <Select
                        value={introPriceId}
                        onValueChange={(v) => setValue('introPriceId', v ?? '')}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {introEligiblePrices.map((p) => (
                            <SelectItem
                              key={p.id}
                              value={p.id}
                              label={
                                `${formatCurrency(Number(p.amount) || 0, currency)} · ` +
                                `${tc(`recurrence_${p.recurrence}`)}` +
                                (p.label ? ` · ${p.label}` : '')
                              }
                            />
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('subTypeIntroAmount')}</Label>
                      <div className="relative w-[140px]">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...register('introAmount')}
                          className="pr-12"
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
                        // Locked to 1 on a weekly/fortnightly plan — see the
                        // note below the field, which says why rather than
                        // leaving a disabled control unexplained.
                        disabled={introSupport === 'first_only'}
                        {...register('introPeriods')}
                        className="w-[110px]"
                        placeholder="3"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('subTypeIntroFreeHint')}</p>
                  {introSupport === 'first_only' && (
                    <p className="text-xs text-amber-600">{t('subTypeIntroWeeklyLimit')}</p>
                  )}
                  {showIntroError && introProblem && (
                    <p className="text-destructive text-xs">
                      {/* `max` is passed for every reason, not just the one
                          that uses it — next-intl throws on a MISSING
                          placeholder and ignores a spare one, so the safe
                          direction is to always supply it. */}
                      {t(`subTypeIntroErr_${introProblem}` as Parameters<typeof t>[0], {
                        max: INTRO_OFFER_MAX_PERIODS,
                      })}
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          {/* Usage limit — caps CLASS bookings covered by this subscription
              per calendar day/week/month. Once spent, the drop-in price still
              applies (member rate); credits and appointments are unaffected. */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('subTypeUsageLimit')}</Label>
                <p className="text-xs text-muted-foreground">{t('subTypeUsageLimitDesc')}</p>
              </div>
              <Switch
                checked={limitEnabled}
                onCheckedChange={(v) => setValue('limitEnabled', v)}
              />
            </div>
            {limitEnabled && (
              <div className="flex items-center gap-2">
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
          </div>

          {/* WHAT THIS PLAN OPENS IS EDITED IN THE CATALOGUE, not here. This
              block was the second author of one relationship — and the two
              disagreed, because it read only `accessRule` and so showed every
              appointment benefit as unlinked. It is one link now, from a screen
              that can also show the other side. */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="space-y-0.5">
              <Label>{t('subTypeActivitiesLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('subTypeActivitiesInCatalogue')}</p>
            </div>
            <Link
              href={
                (editing
                  ? `/offer/catalogue?sel=plan:${editing.id}`
                  : '/offer/catalogue') as Route
              }
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('subTypeActivitiesOpenCatalogue')}
            </Link>
          </div>

          {/* Automations referencing this subscription + a quick create shortcut */}
          {editing && <SubscriptionAutomationsSection teamId={teamId} subscriptionType={editing} />}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : t('save')}
            </Button>
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ['subscription-types', teamId] })

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
                        {st.introOffer && resolveIntroOffer(st, st.introOffer.priceId) && (
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
