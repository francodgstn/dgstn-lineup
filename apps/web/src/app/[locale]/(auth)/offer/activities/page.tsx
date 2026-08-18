'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import { toast } from 'sonner'
import {
  collection, addDoc, updateDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ACTIVITIES_COLLECTION, TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION, resolveActivityAccessRule, resolveAutoConfirm } from '@linyup/shared'
import { resolveDurationSale } from '@linyup/shared'
import type { Activity, ActivityDuration, ActivityLevel, ActivityType, DurationSaleMode, SaasPlan, SubscriptionType, FormField } from '@linyup/shared'

/** The waitlist's plan gate, mirroring the server side of it
 *  (`requirePlan(teamId, 'coach')` in joinWaitlist). One constant, because a
 *  toggle a tenant can set and a queue that then refuses every join is worse
 *  than no toggle at all. */
const WAITLIST_MIN_PLAN: SaasPlan = 'coach'
import { BookingQuestionsEditor } from '@/components/activities/BookingQuestionsEditor'
import { MoreOptions } from '@/components/forms/MoreOptions'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { useActivities } from '@/hooks/useActivities'
import { useBookingSettings } from '@/hooks/useBookingSettings'
import { usePlan } from '@/hooks/usePlan'
import { usePlanName } from '@/hooks/usePlanName'
import { resolveActivityTerms } from '@/lib/activityTerms'
import {
  BenefitEditor,
  toBenefitFormValue,
  toBenefitPayload,
  defaultBenefitFormValue,
  benefitPercentInvalid,
  benefitAmountInvalid,
} from '@/components/pricing/BenefitEditor'
import { formatCurrency } from '@/lib/format'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ColorPicker, DEFAULT_ACCENT } from '@/components/ui/color-picker'
import { PageHeader } from '@/components/layout/PageHeader'
import { SortableList, SortableItem, type SortableRenderProps } from '@/components/ui/sortable'
import { formatDuration } from '@/components/sessions/SessionFormDialog'
import { Plus, Pencil, Copy, Archive, ImageIcon, X, GripVertical, ChevronDown, ChevronRight } from 'lucide-react'

// ─── archive confirm dialog ───────────────────────────────────────────────────

function ArchiveConfirmDialog({
  activity,
  onConfirm,
  onCancel,
}: {
  activity: Activity | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('Activities')
  return (
    <Dialog open={!!activity} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('archive')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          {activity ? t('archiveConfirm', { name: activity.name }) : ''}
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('archive')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

// The form keeps price as a STRING per duration ('' unambiguously means "no price
// yet"), vs. the persisted shape's `priceAmount: number | null`. These two helpers
// convert between the two: `toDurationFormValues` hydrates the form from a saved
// activity (edit mode); `toActivityDurations` builds the payload on submit.
// History: durations also carried a per-duration × per-subscription-type
// `subscriptionPricing` matrix until 2026-07; member benefit is now ONE rule
// per activity (see `BenefitFormValue` in components/pricing/BenefitEditor) —
// see ActivityDuration's doc comment in @linyup/shared.

interface DurationFormValue {
  minutes: number
  price: string
  /** THE FORM holds the tri-state explicitly, the DOCUMENT does not (see
   *  `ActivityDuration` in @linyup/shared): "priced with the box still empty"
   *  and "free" are the same stored bytes but different intentions, and only a
   *  stored mode can tell the validator which one the coach meant. */
  mode: DurationSaleMode
}

function toDurationFormValues(durations?: ActivityDuration[] | null): DurationFormValue[] {
  return (durations ?? []).map((d) => {
    const sale = resolveDurationSale(d)
    return {
      minutes: d.minutes,
      price: sale.priceAmount != null ? String(sale.priceAmount) : '',
      mode: sale.mode,
    }
  })
}

function toActivityDurations(durations: DurationFormValue[]): ActivityDuration[] {
  return [...durations]
    .sort((a, b) => a.minutes - b.minutes)
    .map((d) => ({
      minutes: d.minutes,
      // A price is written ONLY in 'priced' mode, so switching a length to
      // "only with a plan" (or back to free) cannot leave a sellable number
      // behind it.
      priceAmount: d.mode === 'priced' && d.price.trim() !== '' ? Number(d.price) : null,
      ...(d.mode === 'benefit_only' ? { benefitOnly: true } : {}),
    }))
}

// The one member-benefit rule for the whole activity — see `Benefit` in
// @linyup/shared. Appointments: applies to every priced duration. Classes:
// applies to the drop-in price (a member rate), only while drop-in is
// enabled. Form value type, hydration/payload helpers and validation now live
// in the shared `BenefitEditor` (components/pricing/), used by both the
// appointment and class sub-forms below.

// ─── constants ────────────────────────────────────────────────────────────────

const LEVELS = ['all', 'beginners', 'intermediate', 'advanced'] as const
// Radix Select cannot carry an empty string as a value, so "not specified" needs
// a sentinel. It is never stored: the submit maps it back to null.
const LEVEL_NONE = '__none__'
const ACTIVITY_TYPES: ActivityType[] = ['class', 'appointment']
// APPOINTMENT-ONLY: the bookable session lengths an appointment activity offers.
const APPOINTMENT_DURATION_PRESETS = [15, 30, 45, 60, 90, 120]

// ─── schema ───────────────────────────────────────────────────────────────────

// Wrapped in a factory so the ≥0.5 price-floor message can be translated — the
// rest of the messages here are pre-existing tech debt (hardcoded English),
// unrelated to this change, left as-is.
function createActivitySchema(
  t: ReturnType<typeof useTranslations>,
  tBenefit: ReturnType<typeof useTranslations>
) {
  return z.object({
    name: z.string().min(1, 'Required').max(80),
    description: z.string().max(500).optional(),
    prerequisites: z.string().max(300).optional(),
    confirmationInstructions: z.string().max(2000).optional(),
    meetingPoint: z.string().max(200).optional(),
    whatsIncluded: z.string().max(1000).optional(),
    whatsNotIncluded: z.string().max(1000).optional(),
    faq: z.string().max(2000).optional(),
    cancellationPolicy: z.string().max(2000).optional(),
    // Book-form questions (shared FormField schema). Validated loosely here —
    // the editor constrains type/count, and blank-labelled rows are dropped on
    // save rather than blocking it.
    bookingQuestions: z.array(z.any()),
    type: z.enum(['class', 'appointment'] as const).default('class'),
    // OPTIONAL. It was mandatory only because the legacy import always had a
    // value; `Activity.level` has always been optional in the type, and the list
    // badge already renders nothing when it is absent. Small studios mostly do
    // not grade their classes, and forcing a choice made them pick "All levels"
    // to mean "not applicable" — two different statements collapsed into one.
    level: z.enum(LEVELS).optional(),
    color: z.string().optional(),
    // CLASS-ONLY paid-access gate (supersedes the legacy isFreeTrial toggle;
    // 'open' === free trial). Appointments dropped this entirely — the price is
    // the only gate; see `memberBenefit` below.
    accessTier: z.enum(['open', 'members', 'subscription'] as const),
    subscriptionTypeIds: z.array(z.string()),
    // Drop-in / pay-per-class: an uncovered contact may pay this to book a single
    // session. CLASS-ONLY.
    dropInEnabled: z.boolean(),
    dropInPrice: z.string(),
    // CLASS-ONLY: independent of accessTier — a gated class still takes a
    // newcomer's trial booking when this is on.
    trialEnabled: z.boolean(),
    // CLASS-ONLY: reduced trial price, kept as a string in form state ('' = free
    // trial, today's behaviour). A number reduces the trial to that price
    // instead of the class's normal price.
    trialPrice: z.string(),
    // CLASS-ONLY: a full session offers a queue instead of a dead end. This is
    // the ONLY place the flag lives — sessions carry no copy of it, so turning
    // it on here reaches every session of the activity, past and future, with
    // no fan-out and nothing to backfill.
    waitlistEnabled: z.boolean(),
    // Does a booking for this activity confirm itself, or wait on studio review?
    // Not implied by `type` — shown for classes and appointments alike.
    autoConfirm: z.boolean(),
    // APPOINTMENT-ONLY: the session lengths clients choose from, each with its
    // own optional base price. Kept as strings in form state ('' = no price
    // yet) — see toDurationFormValues / toActivityDurations for the conversion
    // to/from the persisted shape.
    durations: z.array(
      z.object({
        minutes: z.number(),
        price: z.string(),
        mode: z.enum(['free', 'priced', 'benefit_only'] as const),
      })
    ),
    // The one member-benefit rule for the whole activity — appointments (every
    // priced duration) and classes (the drop-in price, while enabled). See
    // BenefitFormValue / toBenefitPayload in components/pricing/BenefitEditor.
    memberBenefit: z.object({
      subscriptionTypeIds: z.array(z.string()),
      effect: z.enum(['included', 'percent_off', 'fixed_price'] as const),
      percent: z.string(),
      amount: z.string(),
    }),
  }).superRefine((d, ctx) => {
    if (d.dropInEnabled && !(d.dropInPrice.trim() !== '' && Number(d.dropInPrice) >= 0.5)) {
      ctx.addIssue({ code: 'custom', path: ['dropInPrice'], message: 'Enter a drop-in price of at least 0.50' })
    }
    if (d.trialPrice.trim() !== '' && !(Number(d.trialPrice) >= 0.5)) {
      ctx.addIssue({ code: 'custom', path: ['trialPrice'], message: t('trialPriceValidation') })
    }
    if (d.type === 'appointment' && d.durations.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['durations'], message: 'Pick at least one session length' })
    }
    d.durations.forEach((dur, i) => {
      // 'priced' with nothing in the box is the one state the stored shape
      // cannot distinguish from free — so it is refused here rather than saved
      // as an accidentally-free one-to-one.
      if (dur.mode === 'priced' && !(Number(dur.price) >= 0.5)) {
        ctx.addIssue({ code: 'custom', path: ['durations', i, 'price'], message: t('durationPriceValidation') })
      }
      if (dur.mode !== 'priced' && dur.price.trim() !== '' && !(Number(dur.price) >= 0.5)) {
        ctx.addIssue({ code: 'custom', path: ['durations', i, 'price'], message: t('durationPriceValidation') })
      }
    })
    if (benefitPercentInvalid(d.memberBenefit)) {
      ctx.addIssue({
        code: 'custom',
        path: ['memberBenefit', 'percent'],
        message: tBenefit('percentValidation'),
      })
    }
    if (benefitAmountInvalid(d.memberBenefit)) {
      ctx.addIssue({
        code: 'custom',
        path: ['memberBenefit', 'amount'],
        message: tBenefit('amountValidation'),
      })
    }
  })
}

type ActivityFormData = z.infer<ReturnType<typeof createActivitySchema>>

// ─── dialog ───────────────────────────────────────────────────────────────────

function ActivityDialog({
  open,
  onClose,
  teamId,
  userId,
  editing,
  duplicating,
  nextOrder,
  currency,
}: {
  open: boolean
  onClose: () => void
  teamId: string
  userId: string
  editing: Activity | null
  /**
   * The activity a NEW one is being copied from. `editing` stays null, so the
   * submit takes the CREATE branch below and every identity field is minted
   * there exactly as it is for a blank activity: a fresh doc id, a slug derived
   * from the "(copy)" name (so it can't collide with the original's), this
   * team, this author, a new `order` at the end of the list. Only the
   * CONFIGURATION is carried over — which is the whole cost being saved.
   */
  duplicating: Activity | null
  /** Order assigned to a newly created activity so it appends to the end. */
  nextOrder: number
  /** Team's billing currency (ISO code), shown next to duration price inputs. */
  currency: string
}) {
  const t = useTranslations('Activities')
  const tBenefit = useTranslations('Benefit')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  // The waitlist is a paid-tier feature, and THIS is where its flag is written —
  // the activity doc is a client write, so the gate has to sit on the control
  // itself (the same shape every other plan-gated toggle uses). `joinWaitlist`
  // carries the matching server-side requirePlan, so the queue can never open
  // below the tier even if the flag were set some other way.
  const { isAtLeast } = usePlan()
  const planName = usePlanName()
  const waitlistAllowed = isAtLeast(WAITLIST_MIN_PLAN)
  // TWO different questions, deliberately not fused. `waitlistAllowed` is "may
  // this studio have queues at all" (plan). `waitlistOffered` is "does this
  // studio use them" — a team-level switch in Settings → Booking, off by
  // default, so a new studio never meets the concept while setting up its first
  // class. Most will never want a queue; the ones who do go looking.
  //
  // It hides the CONTROL, not the feature: an activity keeps whatever flag it
  // already had, and anyone already in a queue keeps their place. Same shape as
  // the plan carry-through below.
  //
  // Read from THE booking-settings store (teams/{id}/public_profile —
  // useBookingSettings), never the team doc: the mirror that used to hold it was
  // owner-only, so a manager's save never reached it (UX-6).
  const { data: bookingSettings } = useBookingSettings(teamId)
  const waitlistOffered = bookingSettings?.waitlistEnabled === true
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  // A copy keeps the cover image: `image_url` is a download URL for a file that
  // outlives the source (activities are ARCHIVED, never deleted), and a new
  // upload on either side writes under its own activity id.
  const [imagePreview, setImagePreview] = useState<string | null>(
    (editing ?? duplicating)?.image_url ?? null
  )
  const activitySchema = useMemo(() => createActivitySchema(t, tBenefit), [t, tBenefit])

  const { data: subscriptionTypes = [] } = useSubscriptionTypes(teamId)
  // ONE seed for the form's starting values: the activity being edited, or the
  // one being copied. `editing` alone still decides which BRANCH of onSubmit
  // runs — a duplicate is a create, and must go down the create path.
  const seed = editing ?? duplicating
  const initialRule = seed
    ? resolveActivityAccessRule(seed)
    : { type: 'open' as const, subscriptionTypeIds: [] as string[] }

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ActivityFormData>({
    resolver: zodResolver(activitySchema),
    defaultValues: seed
      ? {
          name: duplicating ? tCommon('copyName', { name: seed.name }) : seed.name,
          description: seed.description ?? '',
          prerequisites: seed.prerequisites ?? '',
          confirmationInstructions: seed.confirmationInstructions ?? '',
          meetingPoint: seed.meetingPoint ?? '',
          whatsIncluded: seed.whatsIncluded ?? '',
          whatsNotIncluded: seed.whatsNotIncluded ?? '',
          faq: seed.faq ?? '',
          cancellationPolicy: seed.cancellationPolicy ?? '',
          bookingQuestions: seed.bookingQuestions ?? [],
          type: (seed.type ?? 'class') as ActivityType,
          level: seed.level ?? undefined,
          color: seed.color ?? '',
          accessTier: initialRule.type,
          subscriptionTypeIds: initialRule.subscriptionTypeIds ?? [],
          dropInEnabled: seed.dropIn?.enabled ?? false,
          dropInPrice: seed.dropIn?.priceAmount != null ? String(seed.dropIn.priceAmount) : '',
          trialEnabled: seed.trialEnabled ?? false,
          trialPrice: seed.trialPriceAmount != null ? String(seed.trialPriceAmount) : '',
          waitlistEnabled: seed.waitlistEnabled ?? false,
          durations: toDurationFormValues(seed.durations),
          memberBenefit: toBenefitFormValue(seed.memberBenefit),
          autoConfirm: resolveAutoConfirm(seed),
        }
      : {
          name: '', description: '', prerequisites: '', confirmationInstructions: '',
          meetingPoint: '', whatsIncluded: '', whatsNotIncluded: '', faq: '', cancellationPolicy: '',
          bookingQuestions: [],
          type: 'class' as ActivityType, level: undefined,
          // Defaults for a NEW activity. 'members' rather than 'open': a studio
          // sells memberships, so a class its members can book is the ordinary
          // case, and 'open' means free for anyone (resolvePaymentOptions
          // short-circuits it to `covered`) — the wrong thing to land on by
          // accident. A newcomer can still be let in via "Free trial for
          // newcomers" below, which is what makes 'members' safe as a default.
          color: DEFAULT_ACCENT, accessTier: 'members', subscriptionTypeIds: [],
          dropInEnabled: false, dropInPrice: '', trialEnabled: false, trialPrice: '',
          waitlistEnabled: false,
          durations: [],
          memberBenefit: defaultBenefitFormValue(),
          // TRUE for a new activity of either kind. `resolveAutoConfirm` is left
          // alone on purpose: it answers what a STORED doc means, and flipping
          // its fallback would silently reinterpret every existing class that
          // never set the field. This is only the form's starting point.
          autoConfirm: true,
        },
  })
  const type = watch('type')
  const accessTier = watch('accessTier')
  const dropInEnabled = watch('dropInEnabled')
  const trialEnabled = watch('trialEnabled')
  const waitlistEnabled = watch('waitlistEnabled')
  const durations = watch('durations') || []
  // Can a 'benefit_only' length actually be opened by anything? Only an
  // INCLUDED benefit is a way in — a percentage off a price that does not exist
  // opens nothing (the resolver refuses it; see the appointment arm).
  const memberBenefitValue = watch('memberBenefit')
  const benefitOpensDoor =
    memberBenefitValue?.effect === 'included' &&
    (memberBenefitValue?.subscriptionTypeIds?.length ?? 0) > 0

  // Does the activity being EDITED already carry anything from the "More
  // options" tail? If so the disclosure opens showing it — a field the studio
  // filled in and then cannot find is worse than the long form this replaces.
  // Colour is compared against the create-time default rather than merely
  // tested for presence: every activity has one, so `!!editing.color` would
  // open the panel every time and the disclosure would do nothing at all.
  const hasStoredDetails =
    !!seed &&
    ((!!seed.color && seed.color !== DEFAULT_ACCENT) ||
      !!seed.level ||
      !!seed.prerequisites ||
      !!seed.confirmationInstructions ||
      !!seed.meetingPoint ||
      !!seed.whatsIncluded ||
      !!seed.whatsNotIncluded ||
      !!seed.faq ||
      !!seed.cancellationPolicy ||
      (seed.bookingQuestions?.length ?? 0) > 0)

  function toggleDuration(minutes: number) {
    setValue(
      'durations',
      durations.some((d) => d.minutes === minutes)
        ? durations.filter((d) => d.minutes !== minutes)
        : [...durations, { minutes, price: '', mode: 'free' as DurationSaleMode }].sort(
            (a, b) => a.minutes - b.minutes
          )
    )
  }

  // Set (or clear) a duration's base price — no pre-fill dance any more: member
  // benefit is ONE rule for the whole activity (see the memberBenefit row),
  // never derived from a price edit.
  function updateDurationPrice(minutes: number, price: string) {
    setValue('durations', durations.map((d) => (d.minutes === minutes ? { ...d, price } : d)))
  }

  // Switch a length between the three ways it can be sold. Changing mode always
  // clears the price box: a number left behind a "free" or "only with a plan"
  // choice is the exact ambiguity this control exists to remove.
  function updateDurationMode(minutes: number, mode: DurationSaleMode) {
    setValue(
      'durations',
      durations.map((d) =>
        d.minutes === minutes ? { ...d, mode, price: mode === 'priced' ? d.price : '' } : d
      )
    )
  }

  // Re-default autoConfirm when the studio flips the type — but only while the
  // toggle hasn't been touched by hand, so an explicit override survives a type
  // change. `prevTypeRef` guards the mount-time run (editing already carries the
  // resolved value in defaultValues; don't clobber an explicit override on open).
  const [autoConfirmTouched, setAutoConfirmTouched] = useState(false)
  const prevTypeRef = useRef(type)
  useEffect(() => {
    if (prevTypeRef.current === type) return
    prevTypeRef.current = type
    // A NEW activity keeps the true default across a type flip; an existing one
    // re-derives from what its kind means, which is the stored-doc question.
    if (!autoConfirmTouched)
      setValue('autoConfirm', editing ? resolveAutoConfirm({ type }) : true)
  }, [type, autoConfirmTouched, setValue, editing])

  // Inline quick-create: "create or link a subscription to this activity" without
  // leaving the form. Writes a minimal type (pricing is configured later in the
  // subscriptions manager) and auto-checks it in the allow-list above.
  const [newSubName, setNewSubName] = useState('')
  const [creatingSub, setCreatingSub] = useState(false)

  async function quickCreateSubscription() {
    const name = newSubName.trim()
    if (!name || creatingSub) return
    setCreatingSub(true)
    try {
      const ref = await addDoc(
        collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION),
        {
          name,
          description: null,
          source: 'internal',
          active: true,
          public: false,
          checkout_contact_mode: 'minimal',
          prices: [],
          order: subscriptionTypes.length,
          created_at: serverTimestamp(),
        },
      )
      setValue('subscriptionTypeIds', [...getValues('subscriptionTypeIds'), ref.id])
      setNewSubName('')
      qc.invalidateQueries({ queryKey: ['subscription-types', teamId] })
    } finally {
      setCreatingSub(false)
    }
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function clearImage() {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function uploadImage(activityId: string): Promise<string | null> {
    if (!imageFile) return null
    const ext = imageFile.name.split('.').pop() ?? 'jpg'
    const storageRef = ref(storage, `teams/${teamId}/activities/${activityId}/cover.${ext}`)
    await uploadBytes(storageRef, imageFile)
    return getDownloadURL(storageRef)
  }

  // Fields common to both kinds.
  function sharedPayload(data: ActivityFormData) {
    return {
      name: data.name,
      description: data.description ?? '',
      prerequisites: data.prerequisites ?? '',
      confirmationInstructions: data.confirmationInstructions ?? '',
      meetingPoint: data.meetingPoint ?? '',
      whatsIncluded: data.whatsIncluded ?? '',
      whatsNotIncluded: data.whatsNotIncluded ?? '',
      faq: data.faq ?? '',
      cancellationPolicy: data.cancellationPolicy ?? '',
      // Drop half-written rows (no label = nothing to ask) so the public form
      // never renders an unlabelled input.
      bookingQuestions: (data.bookingQuestions ?? [])
        .filter((q: FormField) => q?.label?.trim())
        .map((q: FormField, i: number) => ({ ...q, label: q.label.trim(), order: i })),
      type: data.type,
      level: data.level ?? null,
      color: data.color ?? '',
      autoConfirm: data.autoConfirm,
    }
  }

  // Appointments dropped accessRule/isFreeTrial/dropIn/trialEnabled entirely —
  // the price is the only gate (see ActivityMemberBenefit's history note). We
  // simply don't write those class-only keys for an appointment: `accessRule`
  // still exists on the doc type (classes use it) but appointment booking
  // paths ignore it everywhere, so leaving a stale value from a prior "class"
  // save untouched is harmless. `durations` IS cleared (null) on a class save
  // (appointment-only). `memberBenefit` is now a CLASS field too (the drop-in
  // member rate) — kept while drop-in is enabled, cleared when it isn't (a
  // benefit with no priced drop-in to modify is inert data the UI can't show).
  function kindSpecificPayload(data: ActivityFormData): Record<string, unknown> {
    if (data.type === 'appointment') {
      return {
        durations: toActivityDurations(data.durations),
        memberBenefit: toBenefitPayload(data.memberBenefit),
      }
    }
    return {
      isFreeTrial: data.accessTier === 'open',
      accessRule: {
        type: data.accessTier,
        ...(data.accessTier === 'subscription'
          ? { subscriptionTypeIds: data.subscriptionTypeIds }
          : {}),
      },
      dropIn: {
        enabled: data.dropInEnabled,
        ...(data.dropInPrice ? { priceAmount: Number(data.dropInPrice) } : {}),
      },
      trialEnabled: data.trialEnabled,
      // Cleared on an open tier — the field is hidden there (the trial door
      // grants nothing extra on a free-to-book class), so a leftover price from
      // a previous tier must not survive as inert data the UI can't show.
      trialPriceAmount:
        data.trialPrice && data.accessTier !== 'open' ? Number(data.trialPrice) : null,
      // Below the tier the stored value is carried through untouched rather than
      // read off a locked control: the gate stops a queue being OPENED, it does
      // not quietly strip one an activity already had (see WAITLIST_MIN_PLAN).
      // Carried through untouched whenever the control was not rendered — below
      // the plan tier, or with the studio-level switch off. Neither gate strips
      // a queue an activity already had; they stop one being OPENED.
      waitlistEnabled:
        waitlistAllowed && (waitlistOffered || editing?.waitlistEnabled === true)
          ? data.waitlistEnabled
          : (editing?.waitlistEnabled ?? false),
      durations: null,
      memberBenefit: data.dropInEnabled ? toBenefitPayload(data.memberBenefit) : null,
    }
  }

  async function onSubmit(data: ActivityFormData) {
    if (editing) {
      // EDIT: the image upload (when there's a new file) runs BEFORE the
      // write, so a throw anywhere in this block means updateDoc never ran —
      // nothing was persisted. One generic message is correct here, and
      // leaving the dialog open with the data intact is the right move: a
      // retry re-attempts the same, still-unsaved, edit.
      try {
        const updates: Record<string, unknown> = {
          ...sharedPayload(data),
          ...kindSpecificPayload(data),
        }
        if (imageFile) {
          const url = await uploadImage(editing.id)
          if (url) updates.image_url = url
        } else if (imagePreview === null && editing.image_url) {
          updates.image_url = null
        }
        await updateDoc(doc(db, ACTIVITIES_COLLECTION, editing.id), updates)
        await qc.invalidateQueries({ queryKey: ['activities'] })
        toast.success(t('savedToast'))
        onClose()
      } catch {
        toast.error(t('saveErrorToast'))
      }
      return
    }

    // CREATE: addDoc runs BEFORE the image upload, so a failed upload leaves
    // a REAL activity behind with no cover image — a partial success, not a
    // failure. A generic "couldn't save" here would be actively wrong: the
    // manager retries, and the retry creates a second, duplicate activity
    // (this reproduced on a fresh account — Storage denied the upload while
    // the Firestore write went through). So the doc write and the image step
    // get their own try/catch, and each failure gets the message that
    // matches what's actually true on the server.
    let newRef: Awaited<ReturnType<typeof addDoc>> | null = null
    try {
      newRef = await addDoc(collection(db, ACTIVITIES_COLLECTION), {
        ...sharedPayload(data),
        ...kindSpecificPayload(data),
        slug: slugify(data.name),
        teamId,
        createdBy: userId,
        isActive: true,
        order: nextOrder,
        created_at: serverTimestamp(),
      })
    } catch {
      // Nothing exists yet — keep the dialog open with the data, retry is correct.
      toast.error(t('saveErrorToast'))
      return
    }

    // The activity document exists from here on. Never leave the dialog open
    // in a way that resubmits this same form — that is what creates the
    // duplicate.
    if (imageFile) {
      try {
        const url = await uploadImage(newRef.id)
        if (url) await updateDoc(newRef, { image_url: url })
      } catch {
        await qc.invalidateQueries({ queryKey: ['activities'] })
        toast.error(t('createdImageErrorToast'))
        onClose()
        return
      }
    }

    await qc.invalidateQueries({ queryKey: ['activities'] })
    toast.success(t('createdToast'))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      {/* Field-rich form (name/description/prereqs/instructions/type/durations/
          access/drop-in/media) — give it room on bigger screens. The fields
          scroll inside DialogBody so Save stays pinned; see THE SCROLL RULE in
          components/ui/dialog.tsx. */}
      <DialogContent className="sm:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('editActivity') : duplicating ? tCommon('duplicate') : t('newActivity')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogBody className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="act-name">{t('fieldName')}</Label>
            <Input id="act-name" {...register('name')} autoFocus />
            {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
          </div>

          {/* "Offer as" — a card switcher rather than a select, because the kind
              drives the whole form and the one-liners carry the entire
              class-vs-appointment distinction: who chooses the time. Same pattern
              as the availability form's mode toggle and the access tiers below. */}
          <div className="space-y-1.5">
            <Label>{t('fieldOfferAs')}</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {ACTIVITY_TYPES.map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      onClick={() => field.onChange(tp)}
                      aria-pressed={field.value === tp}
                      className={`rounded-lg border p-2.5 text-left transition-colors ${
                        field.value === tp
                          ? 'border-primary bg-primary/5'
                          : 'hover:border-foreground/30'
                      }`}
                    >
                      <span className="block text-sm font-medium">{t(`type_${tp}` as const)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`type_${tp}_desc` as const)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            />
            {editing && watch('type') !== (editing.type ?? 'class') && (
              <p className="text-xs text-muted-foreground">
                {t('typeChangeWarning')}
              </p>
            )}
          </div>

          {/* Metadata — cover 30% / description 70% on wide screens. The grid
              stretches both columns to the taller one (the description), and the
              cover is flex-1 inside its column so it grows to match rather than
              leaving dead space beside the textarea. */}
          <div className="grid gap-4 lg:grid-cols-[3fr_7fr]">
            <div className="flex flex-col space-y-1.5">
              <Label>{t('fieldImage')}</Label>
              {imagePreview ? (
                <div className="relative w-full flex-1 min-h-32 rounded-lg overflow-hidden border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute top-1.5 right-1.5 rounded-full bg-background/80 p-1 hover:bg-background transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex-1 min-h-32 rounded-lg border-2 border-dashed border-input hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ImageIcon className="h-5 w-5" />
                  <span className="text-xs">Click to upload</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="act-desc">{t('fieldDescription')}</Label>
              <textarea
                id="act-desc"
                {...register('description')}
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
              />
            </div>
          </div>

          {/* ── The decisions ──────────────────────────────────────────────
              Access, price, the trial door and the queue: what someone is
              charged and who can get in. Grouped and ordered here, NEVER moved
              behind the disclosure below — see components/forms/MoreOptions.tsx
              for why, and UX-11 for the public half of the same rule. */}
          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium">{t('sectionBookingTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('sectionBookingSubtitle')}</p>
            </div>

            {/* CLASS-ONLY: appointments dropped the access gate entirely — the
                price is the only gate (see the member-benefit row below). */}
            {type === 'class' && (
              <div className="space-y-2">
                <Label>{t('accessLabel')}</Label>
                <Controller
                  control={control}
                  name="accessTier"
                  render={({ field }) => (
                    // Selectable tier cards (3-across when the dialog is wide) —
                    // same pattern as the availability form's mode toggle.
                    <div className="grid gap-2 lg:grid-cols-3">
                      {(['open', 'members', 'subscription'] as const).map((tier) => (
                        <label
                          key={tier}
                          className={`flex items-start gap-2 cursor-pointer text-sm rounded-lg border p-2.5 transition-colors ${
                            field.value === tier ? 'border-primary bg-primary/5' : 'hover:border-foreground/30'
                          }`}
                        >
                          <input
                            type="radio"
                            className="mt-0.5 accent-primary"
                            checked={field.value === tier}
                            onChange={() => field.onChange(tier)}
                          />
                          <span>
                            <span className="font-medium">{t(`access_${tier}`)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {t(`access_${tier}_desc`)}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                />
                {accessTier === 'subscription' && (
                  <Controller
                    control={control}
                    name="subscriptionTypeIds"
                    render={({ field }) => (
                      <div className="space-y-1.5 rounded-md border p-3">
                        {subscriptionTypes.length === 0 ? (
                          /* The tier that gates on subscription types, with none to
                             gate on: the sentence named the destination and went
                             nowhere (UX-99). Link it, like UX-92 did on the session
                             and appointment pickers. */
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">{t('accessNoSubs')}</p>
                            <Link
                              href={'/offer/plans' as Route}
                              className={buttonVariants({ variant: 'outline', size: 'sm' })}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {t('accessNoSubsAction')}
                            </Link>
                          </div>
                        ) : (
                          subscriptionTypes.map((s) => (
                            <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="checkbox"
                                className="accent-primary"
                                checked={field.value.includes(s.id)}
                                onChange={(e) =>
                                  field.onChange(
                                    e.target.checked
                                      ? [...field.value, s.id]
                                      : field.value.filter((id: string) => id !== s.id),
                                  )
                                }
                              />
                              {s.name}
                            </label>
                          ))
                        )}
                        <div className="flex items-center gap-2 pt-1.5 border-t mt-1.5">
                          <Input
                            value={newSubName}
                            onChange={(e) => setNewSubName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void quickCreateSubscription()
                              }
                            }}
                            placeholder={t('quickCreateSubPlaceholder')}
                            className="h-8 text-sm flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!newSubName.trim() || creatingSub}
                            onClick={() => void quickCreateSubscription()}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            {t('quickCreateSubButton')}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t('quickCreateSubHint')}</p>
                      </div>
                    )}
                  />
                )}
              </div>
            )}

            {/* The per-activity switches, gathered into one outlined group:
                label (+ hint) on the left, control on the right, one per row.
                Session lengths join the group for appointments only. */}
            <div className="divide-y rounded-lg border">
              {/* A field, not implied by type: either kind may require a review step. */}
              <Controller
                name="autoConfirm"
                control={control}
                render={({ field }) => (
                  <label className="flex cursor-pointer items-center justify-between gap-4 p-3">
                    <span className="text-sm font-medium">{t('fieldAutoConfirm')}</span>
                    <input
                      type="checkbox"
                      className="accent-primary shrink-0"
                      checked={field.value}
                      onChange={(e) => {
                        setAutoConfirmTouched(true)
                        field.onChange(e.target.checked)
                      }}
                    />
                  </label>
                )}
              />

              {/* CLASS-ONLY: independent of the access tier above — a gated class
                  may still take a newcomer's trial booking. The optional trial
                  price sits under the toggle: empty keeps the trial free (today's
                  behaviour); a number reduces it to that price instead of the
                  class's normal price. */}
              {type === 'class' && (
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 pr-4">
                      <p className="text-sm font-medium">{t('fieldTrialEnabled')}</p>
                      <p className="text-xs text-muted-foreground">{t('trialEnabledHint')}</p>
                    </div>
                    <input type="checkbox" {...register('trialEnabled')} className="accent-primary shrink-0" />
                  </div>
                  {/* Only on a GATED class — on an open one the trial door grants
                      nothing extra (everyone books free), so a price there would be
                      silently ignored by `bookSession`. Offering the field would
                      promise a charge the backend never makes. */}
                  {trialEnabled && accessTier !== 'open' && (
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
                          {...register('trialPrice')}
                          placeholder={t('trialPricePlaceholder')}
                          className="h-8 w-24 text-sm"
                        />
                      </div>
                    </div>
                  )}
                  {errors.trialPrice && <p className="text-destructive text-xs">{errors.trialPrice.message}</p>}
                </div>
              )}

              {/* CLASS-ONLY: the queue behind a full session. Independent of every
                  other door here — a members-only class, a drop-in class and an
                  open one all fill up the same way. Appointments have none: an
                  appointment session does not exist until it is booked, so
                  "this one is full" has no meaning there. */}
              {type === 'class' && (waitlistOffered || editing?.waitlistEnabled === true) && (
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 pr-4">
                      <p className="text-sm font-medium">{t('waitlistEnabledLabel')}</p>
                      <p className="text-xs text-muted-foreground">{t('waitlistEnabledHint')}</p>
                    </div>
                    <input
                      type="checkbox"
                      {...register('waitlistEnabled')}
                      disabled={!waitlistAllowed}
                      className="accent-primary shrink-0 disabled:opacity-40"
                    />
                  </div>
                  {/* The plan gate, on the control that writes the flag. */}
                  {!waitlistAllowed && (
                    <p className="text-xs text-muted-foreground">
                      {t('waitlistRequiresPlan', { plan: planName(WAITLIST_MIN_PLAN) })}
                    </p>
                  )}
                  {/* Not a validation error: the limit lives on each SESSION, not
                      here, so the form cannot know whether any of them has one. */}
                  {waitlistAllowed && waitlistEnabled && (
                    <p className="text-xs text-muted-foreground">{t('waitlistRequiresCapacity')}</p>
                  )}
                </div>
              )}

              {/* CLASS-ONLY: the one drop-in concept — always visible, not nested
                  under an access tier. */}
              {type === 'class' && (
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 pr-4">
                      <p className="text-sm font-medium">{t('dropInLabel')}</p>
                      <p className="text-xs text-muted-foreground">{t('dropInHelp')}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input type="checkbox" {...register('dropInEnabled')} className="accent-primary" />
                      {dropInEnabled && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{currency}</span>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            {...register('dropInPrice')}
                            placeholder={t('dropInPricePlaceholder')}
                            className="h-8 w-24 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  {errors.dropInPrice && <p className="text-destructive text-xs">{errors.dropInPrice.message}</p>}

                  {/* Member rate on the drop-in price — only while drop-in is
                      enabled (a benefit with no priced drop-in to modify is
                      inert). Coverage (free/credits) stays the access tier's
                      job; this only ever lowers the PRICE a not-covered member
                      pays. */}
                  {dropInEnabled && (
                    <div className="pt-2 mt-1 border-t">
                      <Controller
                        control={control}
                        name="memberBenefit"
                        render={({ field }) => (
                          <BenefitEditor
                            value={field.value}
                            onChange={field.onChange}
                            subscriptionTypes={subscriptionTypes}
                            context="class"
                            percentError={errors.memberBenefit?.percent?.message}
                            amountError={errors.memberBenefit?.amount?.message}
                          />
                        )}
                      />
                    </div>
                  )}
                </div>
              )}

              {type === 'appointment' && (
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t('fieldDurationsMinutes')}</p>
                      <p className="text-xs text-muted-foreground">{t('durationsMinutesHint')}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {APPOINTMENT_DURATION_PRESETS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDuration(d)}
                          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                            durations.some((x) => x.minutes === d)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-muted-foreground border-border hover:border-foreground'
                          }`}
                        >
                          {formatDuration(d)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {errors.durations?.message && (
                    <p className="text-destructive text-xs">{errors.durations.message}</p>
                  )}

                  {/* One sub-row per SELECTED duration — the coach sells TIME, so
                      how it is sold is per-length, not one flat activity price.
                      THREE modes, because an empty price used to mean two things
                      at once (UX-70): free for anyone · priced · not sold
                      individually, i.e. only through the member benefit below.
                      There is still no access rule on an appointment — the third
                      mode says only that there is no individual price to quote. */}
                  {durations.length > 0 && (
                    <div className="space-y-2 rounded-md bg-muted/30 p-2.5">
                      <p className="text-xs text-muted-foreground">{t('durationPriceHint')}</p>
                      {[...durations]
                        .sort((a, b) => a.minutes - b.minutes)
                        .map((d) => {
                          const idx = durations.findIndex((x) => x.minutes === d.minutes)
                          const priceError = errors.durations?.[idx]?.price?.message
                          const modes: Array<{ value: DurationSaleMode; label: string }> = [
                            { value: 'free', label: t('durationModeFree') },
                            { value: 'priced', label: t('durationModePriced') },
                            { value: 'benefit_only', label: t('durationModeBenefitOnly') },
                          ]
                          return (
                            <div key={d.minutes} className="space-y-1.5 rounded-md border bg-background p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-medium">{formatDuration(d.minutes)}</span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {modes.map((m) => (
                                    <button
                                      key={m.value}
                                      type="button"
                                      onClick={() => updateDurationMode(d.minutes, m.value)}
                                      aria-pressed={d.mode === m.value}
                                      className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                                        d.mode === m.value
                                          ? 'bg-primary text-primary-foreground border-primary'
                                          : 'bg-background text-muted-foreground border-border hover:border-foreground'
                                      }`}
                                    >
                                      {m.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {d.mode === 'priced' && (
                                <div className="flex items-center justify-end gap-1.5">
                                  <span className="text-xs text-muted-foreground">{currency}</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={d.price}
                                    onChange={(e) => updateDurationPrice(d.minutes, e.target.value)}
                                    placeholder="0.00"
                                    className="h-8 w-24 text-sm"
                                    aria-label={t('durationPriceLabel', { duration: formatDuration(d.minutes) })}
                                  />
                                </div>
                              )}
                              {/* A pack-only length with nothing that covers it is
                                  bookable by NOBODY — said here, where it is
                                  authored, as well as on the pricing health page. */}
                              {d.mode === 'benefit_only' && (
                                <p
                                  className={`text-xs ${
                                    benefitOpensDoor ? 'text-muted-foreground' : 'text-destructive'
                                  }`}
                                >
                                  {benefitOpensDoor
                                    ? t('durationBenefitOnlyHint')
                                    : t('durationBenefitOnlyNoWayIn')}
                                </p>
                              )}
                              {priceError && <p className="text-destructive text-xs">{priceError}</p>}
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* APPOINTMENT-ONLY: the one member-benefit rule for the whole
                  activity — every priced duration. Absent selection = no
                  benefit, everyone pays base. */}
              {type === 'appointment' && (
                <div className="p-3 space-y-3">
                  <Controller
                    control={control}
                    name="memberBenefit"
                    render={({ field }) => (
                      <BenefitEditor
                        value={field.value}
                        onChange={field.onChange}
                        subscriptionTypes={subscriptionTypes}
                        context="appointment"
                        percentError={errors.memberBenefit?.percent?.message}
                        amountError={errors.memberBenefit?.amount?.message}
                      />
                    )}
                  />
                </div>
              )}
            </div>
          </section>

          {/* ── Everything with an honest default ─────────────────────────────
              Presentation and the public-page prose. Every field in here is
              optional and an empty one renders nothing, so a studio that never
              opens this ships a correct class. Opened up-front when the
              activity being edited already carries any of it — a field she
              filled in must never be the one she cannot find. */}
          <MoreOptions
            label={t('moreOptionsLabel')}
            hint={t('moreOptionsHint')}
            defaultOpen={hasStoredDetails}
          >
            <div className="divide-y rounded-lg border">
              <div className="flex items-center justify-between gap-4 p-3">
                <Label htmlFor="act-color" className="font-medium">{t('fieldColor')}</Label>
                <Controller
                  name="color"
                  control={control}
                  render={({ field }) => (
                    <ColorPicker
                      id="act-color"
                      value={field.value}
                      onChange={field.onChange}
                      aria-label={t('fieldColor')}
                    />
                  )}
                />
              </div>

              <div className="flex items-center justify-between gap-4 p-3">
                <Label htmlFor="act-level" className="font-medium">{t('fieldLevel')}</Label>
                <Controller
                  name="level"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? LEVEL_NONE}
                      onValueChange={(v) => field.onChange(v === LEVEL_NONE ? undefined : v)}
                    >
                      <SelectTrigger className="w-44">
                        <span className="flex flex-1 text-left text-sm truncate">
                          {field.value ? (
                            t(`level_${field.value}` as const)
                          ) : (
                            <span className="text-muted-foreground">{t('level_none')}</span>
                          )}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={LEVEL_NONE}>{t('level_none')}</SelectItem>
                        {LEVELS.map((l) => (
                          <SelectItem key={l} value={l}>{t(`level_${l}` as const)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {/* Secondary prose — side by side when the dialog is wide */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="act-prereq">{t('fieldPrerequisites')}</Label>
                <textarea
                  id="act-prereq"
                  {...register('prerequisites')}
                  rows={3}
                  placeholder={t('prerequisitesPlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                />
                <p className="text-xs text-muted-foreground">{t('prerequisitesHelp')}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="act-confirm-instructions">{t('fieldConfirmationInstructions')}</Label>
                <textarea
                  id="act-confirm-instructions"
                  {...register('confirmationInstructions')}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y"
                />
                <p className="text-xs text-muted-foreground">{t('confirmationInstructionsHelp')}</p>
              </div>

              {/* Rich detail shown on the public booking page before a visitor
                  books — everything the item page in a mature booking tool
                  answers up front so it never becomes a support email. */}
              <div className="space-y-1.5">
                <Label htmlFor="act-meeting-point">{t('fieldMeetingPoint')}</Label>
                <Input
                  id="act-meeting-point"
                  {...register('meetingPoint')}
                  placeholder={t('meetingPointPlaceholder')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="act-whats-included">{t('fieldWhatsIncluded')}</Label>
                <textarea
                  id="act-whats-included"
                  {...register('whatsIncluded')}
                  rows={3}
                  placeholder={t('whatsIncludedPlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y"
                />
                <p className="text-xs text-muted-foreground">{t('whatsIncludedHelp')}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="act-whats-not-included">{t('fieldWhatsNotIncluded')}</Label>
                <textarea
                  id="act-whats-not-included"
                  {...register('whatsNotIncluded')}
                  rows={3}
                  placeholder={t('whatsIncludedPlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="act-faq">{t('fieldFaq')}</Label>
                <textarea
                  id="act-faq"
                  {...register('faq')}
                  rows={4}
                  placeholder={t('faqPlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="act-cancellation-policy">{t('fieldCancellationPolicy')}</Label>
                <textarea
                  id="act-cancellation-policy"
                  {...register('cancellationPolicy')}
                  rows={3}
                  placeholder={t('cancellationPolicyPlaceholder')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-y"
                />
                <p className="text-xs text-muted-foreground">{t('cancellationPolicyHelp')}</p>
              </div>

              <Controller
                control={control}
                name="bookingQuestions"
                render={({ field }) => (
                  <BookingQuestionsEditor
                    value={(field.value ?? []) as FormField[]}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
          </MoreOptions>
          </DialogBody>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('saving') : editing ? t('saveChanges') : t('createActivity')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── activity card ────────────────────────────────────────────────────────────

// Money-chip label for one resolved term — the only NEW badges this list adds
// (the free trial / gate badges keep their existing, separate badge block
// below; a PRICED trial gets a money chip here instead, since it's a real
// money story). Benefit chips try to stay compact by resolving a single
// subscription type's name when the admin already has the list loaded;
// multiple types (or an unresolved id) fall back to the generic label.
function moneyChipLabel(
  term: ReturnType<typeof resolveActivityTerms>[number],
  currency: string,
  subscriptionTypes: SubscriptionType[],
  t: ReturnType<typeof useTranslations>,
): string | null {
  const nameFor = (ids?: string[]) =>
    ids?.length === 1 ? subscriptionTypes.find((s) => s.id === ids[0])?.name : undefined

  switch (term.kind) {
    case 'trial':
      return typeof term.amount === 'number'
        ? t('chipTrialPriced', { amount: formatCurrency(term.amount, currency) })
        : null
    case 'dropIn':
      return t('chipDropIn', { amount: formatCurrency(term.amount ?? 0, currency) })
    case 'price':
      return term.min === term.max
        ? formatCurrency(term.min ?? 0, currency)
        : `${formatCurrency(term.min ?? 0, currency)}–${formatCurrency(term.max ?? 0, currency)}`
    case 'benefitIncluded': {
      const name = nameFor(term.subscriptionTypeIds)
      return name ? t('chipBenefitIncludedNamed', { name }) : t('chipBenefitIncluded')
    }
    case 'benefitDiscount': {
      const name = nameFor(term.subscriptionTypeIds)
      return name
        ? t('chipBenefitDiscountNamed', { percent: term.percent ?? 0, name })
        : t('chipBenefitDiscount', { percent: term.percent ?? 0 })
    }
    default:
      return null
  }
}

function ActivityCard({
  activity,
  onEdit,
  onDuplicate,
  onArchive,
  sortable,
  currency,
  subscriptionTypes,
}: {
  activity: Activity
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  sortable: SortableRenderProps
  currency: string
  subscriptionTypes: SubscriptionType[]
}) {
  const t = useTranslations('Activities')
  const tCommon = useTranslations('Common')
  const { setNodeRef, style, attributes, listeners, isDragging } = sortable
  const moneyTerms = resolveActivityTerms(activity).filter(
    // The FREE trial keeps its own badge below (freeTrialBadge); a PRICED
    // trial is a real money story, so it earns a money chip here instead.
    (term) => (term.kind !== 'trial' && term.kind !== 'gate') || (term.kind === 'trial' && typeof term.amount === 'number')
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border bg-card ${
        isDragging ? 'shadow-lg' : 'hover:shadow-sm'
      } transition-shadow`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-1 -ml-1 rounded text-muted-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing touch-none"
        aria-label={t('reorder')}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {activity.image_url ? (
        <div className="h-10 w-10 rounded-md overflow-hidden flex-shrink-0 ring-1 ring-inset ring-black/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activity.image_url} alt="" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div
          className="h-4 w-4 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: activity.color ?? '#e5e7eb' }}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{activity.name}</p>
          {activity.type === 'appointment' && (
            <Badge variant="secondary" className="text-xs">{t('type_appointment')}</Badge>
          )}
          {(() => {
            const raw = activity.level
            if (!raw) return null
            const key = raw.toLowerCase().replace(/\s+/g, '_')
            if (key === 'all' || key === 'all_levels') return null
            const known = ['beginners', 'intermediate', 'advanced'] as const
            const match = known.find((k) => k === key)
            return match ? (
              <Badge variant="secondary" className="text-xs">
                {t(`level_${match}` as const)}
              </Badge>
            ) : null
          })()}
          {(() => {
            const rule = resolveActivityAccessRule(activity)
            if (rule.type === 'subscription')
              return <Badge variant="outline" className="text-xs">{t('accessBadgeSubscription')}</Badge>
            if (rule.type === 'members')
              return <Badge variant="outline" className="text-xs">{t('access_members')}</Badge>
            return activity.isFreeTrial ? (
              <Badge variant="outline" className="text-xs">{t('freeTrialBadge')}</Badge>
            ) : null
          })()}
          {moneyTerms.map((term, i) => {
            const label = moneyChipLabel(term, currency, subscriptionTypes, t)
            return label ? (
              <Badge key={`${term.kind}-${i}`} variant="secondary" className="text-xs">
                {label}
              </Badge>
            ) : null
          })}
        </div>
        {activity.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{activity.description}</p>
        )}
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={onEdit}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          title={t('editActivity')}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onDuplicate}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          title={tCommon('duplicate')}
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          onClick={onArchive}
          className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
          title={t('archive')}
        >
          <Archive className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ActivitiesPage() {
  const { currentTeamId, user, team } = useAuth()
  const { data: activities = [], isLoading } = useActivities(currentTeamId)
  const { data: subscriptionTypes = [] } = useSubscriptionTypes(currentTeamId)
  const currency = team?.default_currency ?? 'CHF'
  const qc = useQueryClient()
  const t = useTranslations('Activities')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Activity | null>(null)
  const [duplicating, setDuplicating] = useState<Activity | null>(null)
  const [archiving, setArchiving] = useState<Activity | null>(null)

  function openNew() { setEditing(null); setDuplicating(null); setDialogOpen(true) }
  function openEdit(a: Activity) { setDuplicating(null); setEditing(a); setDialogOpen(true) }
  // A copy OPENS in the same dialog rather than being written silently: the name
  // and everything else is there to change before anything exists.
  function openDuplicate(a: Activity) { setEditing(null); setDuplicating(a); setDialogOpen(true) }
  function closeDialog() { setDialogOpen(false); setEditing(null); setDuplicating(null) }

  async function handleArchiveConfirm() {
    if (!archiving) return
    await updateDoc(doc(db, ACTIVITIES_COLLECTION, archiving.id), { isActive: false })
    await qc.invalidateQueries({ queryKey: ['activities'] })
    setArchiving(null)
  }

  // The admin list is split into Classes and Appointments. Legacy docs without a
  // type count as classes, matching the model's default.
  const classActivities = activities.filter((a) => a.type !== 'appointment')
  const appointmentActivities = activities.filter((a) => a.type === 'appointment')
  const [collapsed, setCollapsed] = useState<{ classes: boolean; appointments: boolean }>({
    classes: false,
    appointments: false,
  })

  // Drag-and-drop reorder, scoped to one section. The moved section's items are
  // permuted among the GLOBAL positions they already occupy, so the other
  // section's ordering (and any interleaving on public surfaces, which sort the
  // full list) is untouched. Persists `order = global index` for the whole list
  // in one batch, normalising docs that never had an explicit order.
  async function reorderSection(section: Activity[], from: number, to: number) {
    if (from === to || !currentTeamId) return
    const nextSection = [...section]
    const [moved] = nextSection.splice(from, 1)
    nextSection.splice(to, 0, moved)
    const inSection = new Set(section.map((a) => a.id))
    let si = 0
    const full = activities.map((a) => (inSection.has(a.id) ? nextSection[si++] : a))
    const batch = writeBatch(db)
    full.forEach((a, i) => {
      if (a.order !== i) batch.update(doc(db, ACTIVITIES_COLLECTION, a.id), { order: i })
    })
    await batch.commit()
    await qc.invalidateQueries({ queryKey: ['activities'] })
  }

  function renderSection(
    key: 'classes' | 'appointments',
    label: string,
    items: Activity[],
  ) {
    const isCollapsed = collapsed[key]
    return (
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
          className="flex w-full items-center gap-1.5 text-left"
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-xs text-muted-foreground">({items.length})</span>
        </button>
        {!isCollapsed &&
          (items.length === 0 ? (
            <p className="pl-6 text-sm text-muted-foreground">{t('sectionEmpty')}</p>
          ) : (
            <SortableList
              ids={items.map((a) => a.id)}
              onReorder={(from, to) => reorderSection(items, from, to)}
            >
              <div className="space-y-2">
                {items.map((a) => (
                  <SortableItem key={a.id} id={a.id}>
                    {(sortable) => (
                      <ActivityCard
                        activity={a}
                        onEdit={() => openEdit(a)}
                        onDuplicate={() => openDuplicate(a)}
                        onArchive={() => setArchiving(a)}
                        sortable={sortable}
                        currency={currency}
                        subscriptionTypes={subscriptionTypes}
                      />
                    )}
                  </SortableItem>
                ))}
              </div>
            </SortableList>
          ))}
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={isLoading ? undefined : t('subtitle', { count: activities.length })}
        action={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t('newActivity')}
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border rounded-xl border-dashed gap-2 bg-card">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
          <button onClick={openNew} className="text-sm text-primary hover:underline">
            {t('emptyAction')}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {renderSection('classes', t('sectionClasses'), classActivities)}
          {renderSection('appointments', t('sectionAppointments'), appointmentActivities)}
        </div>
      )}

      {currentTeamId && user && (
        <ActivityDialog
          key={editing?.id ?? (duplicating ? `copy-${duplicating.id}` : 'new')}
          open={dialogOpen}
          onClose={closeDialog}
          teamId={currentTeamId}
          userId={user.uid}
          editing={editing}
          duplicating={duplicating}
          nextOrder={activities.length}
          currency={team?.default_currency ?? 'CHF'}
        />
      )}

      <ArchiveConfirmDialog
        activity={archiving}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiving(null)}
      />
    </div>
  )
}
