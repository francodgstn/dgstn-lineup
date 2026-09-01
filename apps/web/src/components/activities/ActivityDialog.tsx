'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { Link } from '@/i18n/navigation'
import { toast } from 'sonner'
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
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
import { FormSection } from '@/components/ui/form-section'
import { Button, buttonVariants } from '@/components/ui/button'
import { ACTIVITIES_COLLECTION, resolveActivityAccessRule, resolveAutoConfirm } from '@linyup/shared'
import { resolveDurationSale, resolveBookingContactFields } from '@linyup/shared'
import { activityRateChoiceOf, gatedPlanIds, ratedPlanIds } from '@linyup/shared'
import { MAX_ACTIVITY_TAGS, normalizeActivityTags, normalizeBookingQuestions } from '@linyup/shared'
import type { Activity, ActivityDuration, ActivityType, DurationSaleMode, SaasPlan, SubscriptionType, FormField, BookingContactField } from '@linyup/shared'

import { BookingQuestionsEditor } from '@/components/activities/BookingQuestionsEditor'
import { ActivityTagsEditor } from '@/components/activities/ActivityTagsEditor'
import { BookingContactFieldsEditor } from '@/components/booking/BookingContactFieldsEditor'
import { ActivityPlanLinks } from '@/components/offer/ActivityPlanLinks'
import { useBookingSettings } from '@/hooks/useBookingSettings'
import { usePlan } from '@/hooks/usePlan'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { useInvalidateSetupChecklist } from '@/hooks/useSetupChecklist'
import { usePlanName } from '@/hooks/usePlanName'
import { ColorPicker, DEFAULT_ACCENT } from '@/components/ui/color-picker'
import { formatDuration } from '@/components/sessions/SessionFormDialog'
import { ImageIcon, X } from 'lucide-react'
/**
 * THE ACTIVITY EDITOR, as a component rather than a page fixture.
 *
 * It lived inside `offer/activities/page.tsx`, which meant the ONLY way to edit
 * an activity was to be on that page — the catalogue, which is where a studio
 * actually reasons about what it sells, could offer nothing but a link away
 * (Franco, 2026-08-31: "move activities/subscriptions popup modals into the
 * catalogue page, so catalogue now becomes the core offer editing").
 *
 * NOTHING ABOUT THE FORM CHANGED in the move. Its schema, its duration helpers
 * and its slug are here with it because nothing else used them; the activities
 * page keeps its list, its card and its archive dialog. Both pages now mount the
 * same component, so there is one activity form in the product and a change to
 * it lands in both places at once.
 */

/** The waitlist's plan gate, mirroring the server side of it
 *  (`requirePlan(teamId, 'coach')` in joinWaitlist). One constant, because a
 *  toggle a tenant can set and a queue that then refuses every join is worse
 *  than no toggle at all. */
const WAITLIST_MIN_PLAN: SaasPlan = 'coach'

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

/**
 * A price typed by a human, as a number.
 *
 * `Number('10,00')` is NaN, and a comma is the decimal separator on a Swiss,
 * German, French and Italian keyboard — which is every locale this product
 * ships in. Typing the price the way the studio's own currency is written made
 * the field fail validation with a message about a minimum, which is not what
 * was wrong. Parse it the same way the refund dialog already does
 * (`RefundPaymentDialog.minorFromMajorInput`).
 *
 * Used by BOTH the validation and the payload, deliberately: two parsers is how
 * a form validates one number and stores a different one.
 */
function parsePriceInput(text: string): number {
  return Number(String(text).trim().replace(',', '.'))
}

function toActivityDurations(durations: DurationFormValue[]): ActivityDuration[] {
  return [...durations]
    .sort((a, b) => a.minutes - b.minutes)
    .map((d) => ({
      minutes: d.minutes,
      // A price is written ONLY in 'priced' mode, so switching a length to
      // "only with a plan" (or back to free) cannot leave a sellable number
      // behind it.
      priceAmount: d.mode === 'priced' && d.price.trim() !== '' ? parsePriceInput(d.price) : null,
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

const ACTIVITY_TYPES: ActivityType[] = ['class', 'appointment']
// APPOINTMENT-ONLY: the bookable session lengths an appointment activity offers.
const APPOINTMENT_DURATION_PRESETS = [15, 30, 45, 60, 90, 120]

// ─── schema ───────────────────────────────────────────────────────────────────

// Wrapped in a factory so the ≥0.5 price-floor message can be translated — the
// rest of the messages here are pre-existing tech debt (hardcoded English),
// unrelated to this change, left as-is.
function createActivitySchema(t: ReturnType<typeof useTranslations>) {
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
    contactFields: z.array(z.object({ key: z.string(), required: z.boolean().optional() })),
    type: z.enum(['class', 'appointment'] as const).default('class'),
    // Free-text display labels for the public booking cards. They replaced a
    // four-value `level` enum that no public surface ever rendered — a studio
    // grades its classes in its own words, or not at all.
    tags: z.array(z.string()).max(MAX_ACTIVITY_TAGS),
    color: z.string().optional(),
    // CLASS-ONLY paid-access gate (supersedes the legacy isFreeTrial toggle;
    // 'open' === free trial). Appointments dropped this entirely — the price is
    // the only gate; see `memberBenefit` below.
    accessTier: z.enum(['open', 'members', 'subscription'] as const),
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
  }).superRefine((d, ctx) => {
    if (d.dropInEnabled && !(d.dropInPrice.trim() !== '' && parsePriceInput(d.dropInPrice) >= 0.5)) {
      ctx.addIssue({ code: 'custom', path: ['dropInPrice'], message: t('dropInPriceValidation') })
    }
    if (d.trialPrice.trim() !== '' && !(parsePriceInput(d.trialPrice) >= 0.5)) {
      ctx.addIssue({ code: 'custom', path: ['trialPrice'], message: t('trialPriceValidation') })
    }
    if (d.type === 'appointment' && d.durations.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['durations'], message: t('durationsRequiredValidation') })
    }
    d.durations.forEach((dur, i) => {
      // 'priced' with nothing in the box is the one state the stored shape
      // cannot distinguish from free — so it is refused here rather than saved
      // as an accidentally-free one-to-one.
      if (dur.mode === 'priced' && !(parsePriceInput(dur.price) >= 0.5)) {
        ctx.addIssue({ code: 'custom', path: ['durations', i, 'price'], message: t('durationPriceValidation') })
      }
      if (dur.mode !== 'priced' && dur.price.trim() !== '' && !(parsePriceInput(dur.price) >= 0.5)) {
        ctx.addIssue({ code: 'custom', path: ['durations', i, 'price'], message: t('durationPriceValidation') })
      }
    })
  })
}

type ActivityFormData = z.infer<ReturnType<typeof createActivitySchema>>

// ─── dialog ───────────────────────────────────────────────────────────────────

export function ActivityDialog({
  open,
  onClose,
  teamId,
  userId,
  editing,
  duplicating,
  nextOrder,
  currency,
  subscriptionTypes,
  canEditPlanLinks,
}: {
  open: boolean
  onClose: () => void
  teamId: string
  userId: string
  /**
   * The LIVE document, re-read from the activities query on every render — not
   * the snapshot taken when the dialog opened. The plan editor below writes
   * `accessRule` on this same document while the form is open, so a stale
   * snapshot here would have this form's Save write the pre-edit allow-list
   * back over it (see `kindSpecificPayload`).
   */
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
  /** The team's plans — the rows of the in-place plan editor. */
  subscriptionTypes: SubscriptionType[]
  /** `team.settings`, the same capability the catalogue gates that editor on. */
  canEditPlanLinks: boolean
}) {
  const t = useTranslations('Activities')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  // A saved activity can move TWO derived setup steps: "add an activity" on its
  // existence, and "set a price" on `dropIn.enabled`. Beside the list
  // invalidation, never instead of it — they are different queries.
  const invalidateSetupChecklist = useInvalidateSetupChecklist()
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
  const { team } = useAuth()
  const { isInstalled } = useInstalledPlugins()
  const waitlistOffered = bookingSettings?.waitlistEnabled === true
  // What the studio already asks for on EVERY booking — shown here as
  // "already collected" rather than as an unticked row, because this list adds
  // to the team default and never replaces it.
  const teamContactFieldKeys = useMemo(
    () => resolveBookingContactFields(bookingSettings, null).map((f) => f.key),
    [bookingSettings]
  )
  const customFieldDefinitions = useMemo(
    () => (isInstalled('custom-fields') ? team?.custom_field_definitions ?? [] : []),
    [isInstalled, team?.custom_field_definitions]
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Does the mounted plan editor hold ticks it has not written yet? It reports
  // this upward because THIS form's Save writes the same document and carries
  // the STORED plan list through — so pressing it would discard them.
  const [planLinksDirty, setPlanLinksDirty] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  // A copy keeps the cover image: `image_url` is a download URL for a file that
  // outlives the source (activities are ARCHIVED, never deleted), and a new
  // upload on either side writes under its own activity id.
  const [imagePreview, setImagePreview] = useState<string | null>(
    (editing ?? duplicating)?.image_url ?? null
  )
  const activitySchema = useMemo(() => createActivitySchema(t), [t])

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
    setError,
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
          contactFields: seed.contactFields ?? [],
          type: (seed.type ?? 'class') as ActivityType,
          // NORMALISED on the way IN, not just on the way out. A stored array
          // longer than the cap (a seed, an older client, a future cap change)
          // would otherwise fail the schema on every submit — and a form whose
          // Save silently does nothing, with the offending field nowhere on
          // screen, is a dead form with no way to diagnose it.
          tags: normalizeActivityTags(seed.tags ?? []),
          color: seed.color ?? '',
          accessTier: initialRule.type,
          dropInEnabled: seed.dropIn?.enabled ?? false,
          dropInPrice: seed.dropIn?.priceAmount != null ? String(seed.dropIn.priceAmount) : '',
          trialEnabled: seed.trialEnabled ?? false,
          trialPrice: seed.trialPriceAmount != null ? String(seed.trialPriceAmount) : '',
          waitlistEnabled: seed.waitlistEnabled ?? false,
          durations: toDurationFormValues(seed.durations),
          autoConfirm: resolveAutoConfirm(seed),
        }
      : {
          name: '', description: '', prerequisites: '', confirmationInstructions: '',
          meetingPoint: '', whatsIncluded: '', whatsNotIncluded: '', faq: '', cancellationPolicy: '',
          bookingQuestions: [],
          contactFields: [],
          type: 'class' as ActivityType, tags: [],
          // Defaults for a NEW activity. 'members' rather than 'open': a studio
          // sells memberships, so a class its members can book is the ordinary
          // case, and 'open' means free for anyone (resolvePaymentOptions
          // short-circuits it to `covered`) — the wrong thing to land on by
          // accident. A newcomer can still be let in via "Free trial for
          // newcomers" below, which is what makes 'members' safe as a default.
          color: DEFAULT_ACCENT, accessTier: 'members',
          dropInEnabled: false, dropInPrice: '', trialEnabled: false, trialPrice: '',
          waitlistEnabled: false,
          durations: [],
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
  // Read from the SAVED activity, not the form: the rule moved to the catalogue,
  // so this dialog can only report what is stored. A duration whose only way in
  // is a benefit therefore answers against the same document the resolver will.
  const benefitOpensDoor =
    !!seed && activityRateChoiceOf(seed).effect === 'included' && ratedPlanIds(seed).length > 0

  // Does the activity being EDITED already carry anything from the "More
  // options" tail? If so the disclosure opens showing it — a field the studio
  // filled in and then cannot find is worse than the long form this replaces.

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

  // THE RADIO IS AUTHORITATIVE FOR THE TIER, so it has to follow the document
  // when the plan editor below moves it — unticking the last plan there stores
  // `members`, and a radio still reading "Subscription" would put the tier back
  // over an empty allow-list on the next Save: a class nobody can book.
  // Keyed on the VALUE, never the document: `editing` is a fresh object on every
  // refetch, and re-running on those would wipe a tier the studio has chosen and
  // not yet saved.
  const storedAccessTier = editing ? resolveActivityAccessRule(editing).type : null
  useEffect(() => {
    if (storedAccessTier) setValue('accessTier', storedAccessTier)
  }, [storedAccessTier, setValue])

  // Inline quick-create: "create or link a subscription to this activity" without
  // leaving the form. Writes a minimal type (pricing is configured later in the
  // subscriptions manager) and auto-checks it in the allow-list above.

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
      // Through the shared normaliser, which drops half-written rows and — the
      // part that was a live crash — writes each key out instead of spreading
      // the editor's object, whose `options` can be an own key holding
      // `undefined`. Firestore refuses that value and the whole save dies.
      bookingQuestions: normalizeBookingQuestions(data.bookingQuestions as FormField[]),
      // EXTENDS the team-wide list, never replaces it — so a row already asked
      // for team-wide is not stored again here (the resolver would dedupe it
      // anyway; not storing it means the activity does not silently pin a
      // choice the studio later changes team-wide).
      contactFields: (data.contactFields ?? []).filter(
        (f: BookingContactField) => !teamContactFieldKeys.includes(f.key)
      ),
      type: data.type,
      tags: normalizeActivityTags(data.tags),
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
      }
    }
    return {
      isFreeTrial: data.accessTier === 'open',
      // THE TIER IS THIS DIALOG'S; THE ALLOW-LIST IS THE PLAN EDITOR'S. The ids
      // are carried through from the stored document rather than read off a
      // control this form does not own — same rule as `waitlistEnabled` below.
      // Without this, saving any edit would blank the plans that editor set.
      //
      // It reads `seed`, which for an edit is the LIVE document: the plan
      // editor is mounted in this very dialog and writes this same field, so a
      // snapshot taken when the dialog opened would put the pre-edit list
      // straight back. For a COPY it is the activity being copied — a duplicate
      // carries its plans like everything else, and a subscription-gated
      // activity with an empty allow-list is one nobody can book.
      accessRule: {
        type: data.accessTier,
        ...(data.accessTier === 'subscription'
          ? { subscriptionTypeIds: gatedPlanIds(seed ?? { type: 'class' }) }
          : {}),
      },
      dropIn: {
        enabled: data.dropInEnabled,
        ...(data.dropInPrice ? { priceAmount: parsePriceInput(data.dropInPrice) } : {}),
      },
      trialEnabled: data.trialEnabled,
      // Cleared on an open tier — the field is hidden there (the trial door
      // grants nothing extra on a free-to-book class), so a leftover price from
      // a previous tier must not survive as inert data the UI can't show.
      trialPriceAmount:
        data.trialPrice && data.accessTier !== 'open' ? parsePriceInput(data.trialPrice) : null,
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
      // `memberBenefit` is NOT written here at all any more. It is the
      // catalogue's, and a dialog that cleared it on an unrelated save would
      // delete a rate the studio set on another screen.
    }
  }

  async function onSubmit(data: ActivityFormData) {
    // A class gated to subscriptions with an empty allow-list is a class NOBODY
    // can book, and nothing downstream refuses it. Checked here rather than in
    // the schema because the ids are not a form field at all — they live on the
    // stored document, written by the plan editor mounted above. Only while
    // editing: a brand-new activity has no id to hang an edge on, which is what
    // `accessPlansAfterSave` tells the studio to come back for.
    if (editing && data.type === 'class' && data.accessTier === 'subscription' &&
        gatedPlanIds(editing).length === 0) {
      setError('accessTier', { type: 'manual', message: t('accessSubscriptionPlansValidation') })
      return
    }
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
        void invalidateSetupChecklist()
        toast.success(t('savedToast'))
        onClose()
      } catch (err) {
        // LOGGED, because the toast cannot be. A studio reporting "it wouldn't
        // save" is reporting the only thing this surface tells them, and a bare
        // `catch {}` threw away the one fact that would have identified the
        // cause. The message stays generic; the console does not.
        console.error('[activities] save failed:', err)
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
    } catch (err) {
      // Nothing exists yet — keep the dialog open with the data, retry is correct.
      console.error('[activities] create failed:', err)
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
      } catch (err) {
        console.error('[activities] cover upload failed:', err)
        await qc.invalidateQueries({ queryKey: ['activities'] })
        void invalidateSetupChecklist()
        toast.error(t('createdImageErrorToast'))
        onClose()
        return
      }
    }

    await qc.invalidateQueries({ queryKey: ['activities'] })
    void invalidateSetupChecklist()
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
              charged and who can get in. Grouped and ordered here, and never
              hidden behind a disclosure — UX-11 is the public half of the same
              rule. This form no longer has one at all. */}
          <FormSection
            title={t('sectionBookingTitle')}
            description={t('sectionBookingSubtitle')}
          >

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
                {accessTier === 'subscription' &&
                  (editing ? (
                    /* WHICH plans, EDITED HERE. For one release this was a link
                       to the catalogue, which sent the studio out of a
                       half-filled form — discarding every unsaved field — to
                       answer the most obvious question the tier raises. The
                       control is back and there is still exactly one writer of
                       the edge, because this mounts THAT writer: the same
                       `ActivityPlanLinks` the catalogue and the subscription
                       editor mount, in its offering direction. The catalogue
                       keeps the plan-side view of the same rows. */
                    <div className="rounded-md border p-3">
                      <ActivityPlanLinks
                        direction="from-offering"
                        offering={{
                          id: editing.id,
                          name: editing.name,
                          collection: ACTIVITIES_COLLECTION,
                          color: editing.color ?? '',
                          target: { kind: 'activity', doc: editing },
                        }}
                        offerings={[]}
                        plans={subscriptionTypes}
                        currency={currency}
                        canEdit={canEditPlanLinks}
                        hostedInForm
                        onDirtyChange={setPlanLinksDirty}
                      />
                    </div>
                  ) : (
                    /* An activity that does not exist yet has no id to hang an
                       edge on. Say so, rather than showing ticks that would be
                       discarded on save. */
                    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      {t('accessPlansAfterSave')}
                    </p>
                  ))}
                {errors.accessTier && (
                  <p className="text-xs text-destructive">{errors.accessTier.message}</p>
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

                  {/* The member rate on this price is set in the catalogue,
                      beside the plans it applies to — it is ONE rule shared by
                      every plan on it, and this dialog could not show who else a
                      change would reprice. */}
                  {dropInEnabled && (
                    <p className="mt-1 border-t pt-2 text-xs text-muted-foreground">
                      {t('dropInRateInCatalogue')}
                    </p>
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
                  activity — every priced duration. It is set in the catalogue,
                  beside the plans it names, because it is ONE rule shared by all
                  of them and a change here would silently reprice the rest. */}
              {type === 'appointment' && (
                <div className="space-y-2 p-3">
                  <p className="text-xs text-muted-foreground">{t('benefitInCatalogue')}</p>
                  <Link
                    href={
                      (editing
                        ? `/offer/catalogue?sel=activity:${editing.id}`
                        : '/offer/catalogue') as Route
                    }
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    {t('accessOpenCatalogue')}
                  </Link>
                </div>
              )}
            </div>
          </FormSection>

          {/* ── Everything with an honest default ─────────────────────────────
              Presentation and the public-page prose. Every field in here is
              optional and an empty one renders nothing, so a studio that never
              opens this ships a correct class. Opened up-front when the
              activity being edited already carries any of it — a field she
              filled in must never be the one she cannot find. */}
          {/* PRESENTATION AND PUBLIC PROSE. Every field here is optional and
              an empty one renders nothing, so a studio that fills in none of it
              still ships a correct class.

              It used to sit behind a "More options" disclosure, which earned
              its keep when this form held every decision about an activity. One
              closed section now hides real fields to save a few hundred pixels
              — and a hidden field is one a studio does not know it has
              (Franco, 2026-09-01). */}
          <FormSection title={t('moreOptionsLabel')} description={t('moreOptionsHint')}>
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

            {/* Display-only, like `prerequisites` below — which is why it sits
                behind the disclosure and not among the decisions above. */}
            <div className="p-3">
              <Controller
                name="tags"
                control={control}
                render={({ field }) => (
                  <ActivityTagsEditor
                    value={(field.value ?? []) as string[]}
                    onChange={field.onChange}
                  />
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

            <Controller
              control={control}
              name="contactFields"
              render={({ field }) => (
                <BookingContactFieldsEditor
                  value={(field.value ?? []) as BookingContactField[]}
                  onChange={field.onChange}
                  definitions={customFieldDefinitions}
                  extendsTeamDefault
                  inheritedKeys={teamContactFieldKeys}
                  customFieldsInstalled={isInstalled('custom-fields')}
                />
              )}
            />
          </div>
          </FormSection>
          </DialogBody>

          <DialogFooter className={planLinksDirty ? 'sm:justify-between' : undefined}>
            {/* The plan editor above owns its own Save and its own document
                write. Saving HERE carries the stored plan list through, so ticks
                left unsaved there are lost — said out loud, next to the button
                that would lose them, rather than after the fact. */}
            {planLinksDirty && (
              <p className="text-xs text-muted-foreground">{t('planLinksUnsaved')}</p>
            )}
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

// The money chips this list adds are derived in `lib/activityTerms.ts`
// (`activityMoneyChipLabels`) — the catalogue's detail pane shows the same facts
// and reads the same function, so the two cannot disagree about, say, whether a
// benefit chip names its plan. The access badges below are separate and stay
// here: they are what a row says about who may book, not about money.
