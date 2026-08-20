'use client'

// Booking page settings — how the public /public/{slug}/booking flow behaves.
// Extracted out of the bio-link editor into its own "Configure" page.
//
// ONE store: `teams/{id}/public_profile/{id}.bookingSettings`. This form writes
// it, this form re-hydrates from it, the public booking page reads it, the
// mobile app reads it and every booking callable reads it
// (packages/functions/src/booking/bookingSettings.ts). The team-doc mirror
// (`settings.booking`) is gone — it was owner-only, so a manager's mirror write
// was denied and the cutoff she had just set applied on the public page and
// nowhere else, while the form showed her the old value (UX-6).

import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useBookingSettings } from '@/hooks/useBookingSettings'
import { useSaveShortcut } from '@/hooks/useSaveShortcut'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { TEAMS_COLLECTION } from '@linyup/shared'
import { resolveBookingContactFields } from '@linyup/shared'
import type {
  Team,
  BookingSettings,
  BookingContactField,
  CustomFieldDefinition,
} from '@linyup/shared'
import { BookingContactFieldsEditor } from '@/components/booking/BookingContactFieldsEditor'
import { useInstalledPlugins } from '@/hooks/useInstalledPlugins'
import { NoShowPolicyCard } from './NoShowPolicyCard'
import { CancellationPolicyCard } from './CancellationPolicyCard'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'

// ─── schema ──────────────────────────────────────────────────────────────────

function createSafeUrlSchema(t: ReturnType<typeof useTranslations>) {
  return z
    .string()
    .refine((v) => v === '' || /^https?:\/\/.+/.test(v), t('errorInvalidUrl'))
    .optional()
}

function createBookingSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    flowType: z.enum(['activity-first', 'date-first']),
    windowMonths: z.number().int().min(1).max(6),
    showPhone: z.boolean(),
    contactFields: z.array(z.object({ key: z.string(), required: z.boolean().optional() })),
    showActivityDescription: z.boolean(),
    showFitnessAppField: z.boolean(),
    ctaUrl: createSafeUrlSchema(t),
    ctaLabel: z.string().optional(),
    appointmentsEnabled: z.boolean().optional(),
    waitlistEnabled: z.boolean().optional(),
    cutoffMinutes: z.number().int().min(0).max(10080),
    // A MAXIMUM, not a guarantee: the claim window is also clamped by the
    // cutoff above and by the session start, and an offer is simply not made
    // when what survives that clamp is too short to reach checkout.
    waitlistClaimMinutes: z.number().int().min(60).max(1440),
  })
}

function createSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({ booking: createBookingSchema(t) })
}

type FormData = z.infer<ReturnType<typeof createSchema>>

// ─── data hook ────────────────────────────────────────────────────────────────

function useTeam(teamId: string | null) {
  return useQuery<Team | null>({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const snap = await getDoc(doc(db, TEAMS_COLLECTION, teamId))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Team) : null
    },
  })
}

function getDefaults(stored: Partial<BookingSettings> | undefined): FormData {
  const rawBooking = (stored ?? {}) as Record<string, unknown>
  const rawMonths = Number(rawBooking.windowMonths)
  const windowMonths =
    Number.isInteger(rawMonths) && rawMonths >= 1 && rawMonths <= 6 ? rawMonths : 2
  const flowType = rawBooking.flowType === 'date-first' ? 'date-first' : 'activity-first'
  const rawCutoff = Number(rawBooking.cutoffMinutes)
  const cutoffMinutes = Number.isInteger(rawCutoff) && rawCutoff >= 0 && rawCutoff <= 10080 ? rawCutoff : 0
  const rawClaim = Number(rawBooking.waitlistClaimMinutes)
  // Absent falls back to the SAME default the promoter applies server-side
  // (WAITLIST_DEFAULT_CLAIM_MINUTES) — showing a different number here than the
  // one actually used is worse than showing none.
  const waitlistClaimMinutes =
    Number.isInteger(rawClaim) && rawClaim >= 60 && rawClaim <= 1440 ? rawClaim : 120
  return {
    booking: {
      flowType,
      windowMonths,
      showPhone: rawBooking.showPhone === true,
      // Seeded from the legacy flag while the list is absent, through the SAME
      // shared fallback the callables and the public form use — so a studio
      // that never opens this page sees exactly what its visitors already get.
      contactFields: resolveBookingContactFields(
        rawBooking as { contactFields?: BookingContactField[]; showPhone?: boolean },
        null
      ),
      showActivityDescription: rawBooking.showActivityDescription !== false,
      // Defaults ON, like showActivityDescription above and unlike showPhone:
      // `!== false` so an absent flag reads as shown. A studio that does not
      // want the field switches it off; a studio that has never opened this
      // page still collects the answer, which is the useful default for a
      // field that only ever adds context to a booking.
      showFitnessAppField: rawBooking.showFitnessAppField !== false,
      ctaUrl: typeof rawBooking.ctaUrl === 'string' ? rawBooking.ctaUrl : '',
      ctaLabel: typeof rawBooking.ctaLabel === 'string' ? rawBooking.ctaLabel : '',
      appointmentsEnabled: rawBooking.appointmentsEnabled === true,
      waitlistEnabled: rawBooking.waitlistEnabled === true,
      cutoffMinutes,
      waitlistClaimMinutes,
    },
  }
}

// ─── booking form ──────────────────────────────────────────────────────────────

// Tiny visual mock of each flow's first step — a mini calendar (date-first) or a
// list of activities (activity-first) — shown on its choice card.
function FlowPreview({
  kind,
  selected,
}: {
  kind: 'activity-first' | 'date-first'
  selected: boolean
}) {
  const accent = selected ? 'bg-primary' : 'bg-foreground/30'
  const accentSoft = selected ? 'bg-primary/40' : 'bg-foreground/20'

  if (kind === 'date-first') {
    return (
      <div className="rounded-md border bg-muted/40 p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <div className={`h-1.5 w-8 rounded ${accentSoft}`} />
          <div className="flex gap-0.5">
            <div className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
            <div className="h-1.5 w-1.5 rounded-full bg-foreground/20" />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: 21 }).map((_, i) => (
            <div
              key={i}
              className={`aspect-square rounded-[2px] ${i === 9 ? accent : 'bg-foreground/[0.08]'}`}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/40 p-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`flex items-center gap-1.5 rounded-[3px] px-1.5 py-1 ${
            i === 0
              ? selected
                ? 'bg-primary/15 ring-1 ring-primary/40'
                : 'bg-foreground/10 ring-1 ring-foreground/20'
              : 'bg-foreground/[0.05]'
          }`}
        >
          <div className={`h-3 w-3 shrink-0 rounded-full ${i === 0 ? accent : 'bg-foreground/25'}`} />
          <div className={`h-1.5 flex-1 rounded ${i === 0 ? accentSoft : 'bg-foreground/20'}`} />
        </div>
      ))}
    </div>
  )
}

// One switch row — a ROW IN A GROUP, not a card. It carries no border of its
// own: the `divide-y rounded-lg border` wrapper draws the box and the hairlines
// between rows, exactly as the activity and subscription forms do. Fourteen
// separately-outlined boxes stacked down a settings pane read as fourteen
// unrelated decisions; one box with dividers reads as one panel, which is what
// it is.
//
// Extracted from the old inline map because the waitlist row nests a control
// inside itself, and two shapes of the same row rendered two different ways is
// how they drift apart.
function ToggleRow({
  control,
  name,
  label,
  desc,
  children,
}: {
  control: ReturnType<typeof useForm<FormData>>['control']
  name: 'booking.showActivityDescription' | 'booking.showFitnessAppField' | 'booking.appointmentsEnabled' | 'booking.waitlistEnabled'
  label: string
  desc: string
  /** Rendered under the row, inside its border — the settings this switch owns. */
  children?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4 p-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <button
              type="button"
              role="switch"
              aria-checked={field.value}
              onClick={() => field.onChange(!field.value)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                field.value ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${
                  field.value ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          )}
        />
      </div>
      {children && <div className="border-t p-3">{children}</div>}
    </div>
  )
}

function BookingForm({
  control,
  register,
  customFieldDefinitions,
}: {
  control: ReturnType<typeof useForm<FormData>>['control']
  register: ReturnType<typeof useForm<FormData>>['register']
  /** Already gated on the custom-fields plugin by the page. */
  customFieldDefinitions: CustomFieldDefinition[]
}) {
  const t = useTranslations('SettingsBooking')
  // Subscribed, not read once: the claim window below appears the moment the
  // queue is switched on, without a save in between.
  const waitlistEnabled = useWatch({ control, name: 'booking.waitlistEnabled' })
  return (
    <div className="space-y-6">
      {/* Flow type */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('flowTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('flowSubtitle')}</p>
        <Controller
          control={control}
          name="booking.flowType"
          render={({ field }) => (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    value: 'activity-first',
                    label: t('flowActivityFirstLabel'),
                    desc: t('flowActivityFirstDesc'),
                  },
                  {
                    value: 'date-first',
                    label: t('flowDateFirstLabel'),
                    desc: t('flowDateFirstDesc'),
                  },
                ] as const
              ).map((opt) => {
                const selected = field.value === opt.value
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer flex-col gap-3 rounded-lg border p-3 transition-colors ${
                      selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <FlowPreview kind={opt.value} selected={selected} />
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        value={opt.value}
                        checked={selected}
                        onChange={() => field.onChange(opt.value)}
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        />
      </div>

      {/* ── ONE PANEL, NOT FOURTEEN CARDS ──────────────────────────────────
          Everything that configures the public booking page now sits in a
          single outlined group with hairlines between rows — the shape the
          activity and subscription forms already use. It replaces a stack of
          individually-bordered cards plus a "More options" disclosure.

          THE DISCLOSURE IS GONE, DELIBERATELY. It was hiding settings that were
          already answered sensibly by default — which is a good reason to
          DEMOTE them (put them lower) and a poor reason to HIDE them: a studio
          looking for the booking window had to guess that a collapsed grey bar
          contained it. Ordering carries that weight instead. What the page
          OFFERS comes first (appointments, waitlist), then how the form BEHAVES
          (window, cutoff, which fields to ask for), then the optional custom
          button last.

          Each of these still has a default that is right for a studio that
          never opens this panel, so none of them is a question it must answer
          to go live:
            • booking window   -> 2 months ahead
            • booking cutoff   -> none, i.e. bookable up to the start
            • ask for a phone  -> off (one less field on the public form)
            • show description -> on (what the studio wrote is what visitors see)
            • fitness-app field-> on
            • custom button    -> empty, so no extra button is rendered
          Nothing here changes what anybody is charged or who may book. */}
      <div className="divide-y rounded-lg border">
      <ToggleRow
        control={control}
        name="booking.appointmentsEnabled"
        label={t('toggleAppointmentsEnabledLabel')}
        desc={t('toggleAppointmentsEnabledDesc')}
      />

      {/* The claim window is the waitlist's OWN setting, so it lives inside the
          waitlist row and renders only once the queue is on. It used to sit
          three rows further up as a peer of the cutoff, where a studio with no
          waitlist at all met it as a question — and where the only thing it
          could possibly do was make a queue that studio did not have worse
          (UX-41). Its default, 120 minutes, is the SAME one the promoter
          applies server-side (WAITLIST_DEFAULT_CLAIM_MINUTES), so a studio that
          switches the queue on and never opens this gets exactly what the
          server would have done anyway. Still a maximum: the cutoff above and
          the session start both clamp it. */}
      <ToggleRow
        control={control}
        name="booking.waitlistEnabled"
        label={t('toggleWaitlistEnabledLabel')}
        desc={t('toggleWaitlistEnabledDesc')}
      >
        {waitlistEnabled && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('waitlistClaimMinutesLabel')}</p>
            <p className="text-xs text-muted-foreground">{t('waitlistClaimMinutesHint')}</p>
            <Controller
              control={control}
              name="booking.waitlistClaimMinutes"
              render={({ field }) => (
                <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                  <SelectTrigger className="h-9 w-48">
                    <span className="flex flex-1 text-left text-sm truncate">
                      {t('waitlistClaimMinutesValue', { minutes: field.value })}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {[60, 120, 240, 480, 1440].map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {t('waitlistClaimMinutesValue', { minutes })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        )}
      </ToggleRow>
        {/* Booking window */}
        <div className="flex items-center justify-between gap-4 p-3">
          <div>
            <p className="text-sm font-medium">{t('windowTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('windowSubtitle')}</p>
          </div>
          <Controller
            control={control}
            name="booking.windowMonths"
            render={({ field }) => (
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <SelectTrigger className="h-9 w-36">
                  <span className="flex flex-1 text-left text-sm truncate">
                    {t('windowMonths', { count: field.value })}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t('windowMonths', { count: 1 })}</SelectItem>
                  <SelectItem value="2">{t('windowMonths', { count: 2 })}</SelectItem>
                  <SelectItem value="3">{t('windowMonths', { count: 3 })}</SelectItem>
                  <SelectItem value="6">{t('windowMonths', { count: 6 })}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>

        {/* Booking cutoff */}
        <div className="flex items-center justify-between gap-4 p-3">
          <div>
            <p className="text-sm font-medium">{t('cutoffTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('cutoffSubtitle')}</p>
          </div>
          <Controller
            control={control}
            name="booking.cutoffMinutes"
            render={({ field }) => (
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <SelectTrigger className="h-9 w-48">
                  <span className="flex flex-1 text-left text-sm truncate">
                    {field.value === 0 ? t('cutoffNone') : t('cutoffMinutesBefore', { minutes: field.value })}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('cutoffNone')}</SelectItem>
                  <SelectItem value="15">{t('cutoffMinutesBefore', { minutes: 15 })}</SelectItem>
                  <SelectItem value="30">{t('cutoffMinutesBefore', { minutes: 30 })}</SelectItem>
                  <SelectItem value="60">{t('cutoffMinutesBefore', { minutes: 60 })}</SelectItem>
                  <SelectItem value="120">{t('cutoffMinutesBefore', { minutes: 120 })}</SelectItem>
                  <SelectItem value="1440">{t('cutoffMinutesBefore', { minutes: 1440 })}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>

        {/* Contact fields — a STACKED row (see the CTA block below for the same
            shape). This replaced the old single "ask for a phone number"
            switch: phone is now one row of this list, so there is one place
            that answers "what does the book form ask for" rather than a
            switch here and a list somewhere else. */}
        <div className="p-3">
          <Controller
            control={control}
            name="booking.contactFields"
            render={({ field }) => (
              <BookingContactFieldsEditor
                value={field.value ?? []}
                onChange={field.onChange}
                definitions={customFieldDefinitions}
              />
            )}
          />
        </div>
        <ToggleRow
          control={control}
          name="booking.showActivityDescription"
          label={t('toggleShowActivityDescriptionLabel')}
          desc={t('toggleShowActivityDescriptionDesc')}
        />
        <ToggleRow
          control={control}
          name="booking.showFitnessAppField"
          label={t('toggleShowFitnessAppLabel')}
          desc={t('toggleShowFitnessAppDesc')}
        />

        {/* CTA button — a STACKED row: two labelled inputs cannot sit opposite
            their own title the way a switch or a select can, so this row keeps
            the group's padding and lets its content run full width. */}
        <div className="space-y-3 p-3">
          <div>
            <p className="text-sm font-medium">{t('ctaTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('ctaSubtitle')}</p>
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('ctaUrlLabel')}</label>
              <Input
                {...register('booking.ctaUrl')}
                type="url"
                placeholder={t('ctaUrlPlaceholder')}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('ctaLabelLabel')}</label>
              <Input
                {...register('booking.ctaLabel')}
                placeholder={t('ctaLabelPlaceholder')}
                className="h-9 text-sm"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function BookingSettingsPage() {
  const { currentTeamId } = useAuth()
  // The team doc is still read for the slug + name copied onto the public
  // profile below; the booking settings themselves come from that same public
  // profile — the one store this form both reads and writes.
  const { data: team, isLoading: teamLoading } = useTeam(currentTeamId)
  const { data: stored, isLoading: settingsLoading } = useBookingSettings(currentTeamId)
  // Gated the same way the contacts list gates them: custom fields are a
  // plugin, and offering rows a studio cannot manage sends them looking for a
  // settings page they do not have.
  const { isInstalled } = useInstalledPlugins()
  const customFieldDefinitions = useMemo(
    () => (isInstalled('custom-fields') ? team?.custom_field_definitions ?? [] : []),
    [isInstalled, team?.custom_field_definitions]
  )
  const isLoading = teamLoading || settingsLoading
  const qc = useQueryClient()
  const t = useTranslations('SettingsBooking')
  const schema = useMemo(() => createSchema(t), [t])

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: getDefaults(stored),
  })

  // Re-hydrate from the store whenever it (re)loads or the team changes —
  // unless the studio has edits in flight, which a background refetch must
  // never throw away.
  useEffect(() => {
    if (stored && !isDirty) reset(getDefaults(stored))
  }, [currentTeamId, stored]) // eslint-disable-line react-hooks/exhaustive-deps

  useSaveShortcut(() => {
    if (isDirty && !isSubmitting) handleSubmit(onSubmit)()
  })

  async function onSubmit(data: FormData) {
    if (!currentTeamId) return
    const bookingSettings: BookingSettings = {
      flowType: data.booking.flowType,
      windowMonths: data.booking.windowMonths,
      // DERIVED, never edited: the legacy flag is only ever read as a fallback
      // while `contactFields` is absent, and saving this form makes it present.
      // Keeping the two in agreement means an older reader (or a rollback)
      // still sees the studio's actual choice rather than a stale switch.
      showPhone: data.booking.contactFields.some((f) => f.key === 'phone'),
      contactFields: data.booking.contactFields,
      showActivityDescription: data.booking.showActivityDescription,
      showFitnessAppField: data.booking.showFitnessAppField,
      ctaUrl: data.booking.ctaUrl || null,
      ctaLabel: data.booking.ctaLabel || null,
      appointmentsEnabled: data.booking.appointmentsEnabled ?? false,
      waitlistEnabled: data.booking.waitlistEnabled ?? false,
      cutoffMinutes: data.booking.cutoffMinutes,
      waitlistClaimMinutes: data.booking.waitlistClaimMinutes,
    }
    try {
      // ONE write, to the one store — team-member writable, world-readable, and
      // what the booking callables read. There is no second write to fail
      // silently behind it.
      const profileRef = doc(db, TEAMS_COLLECTION, currentTeamId, 'public_profile', currentTeamId)
      await setDoc(
        profileRef,
        { type: 'team', slug: team?.slug ?? '', name: team?.name ?? '', bookingSettings },
        { merge: true }
      )
      // Saved state, from what was actually written — the form is clean again
      // and the next background refetch has nothing to disagree with.
      reset(getDefaults(bookingSettings))
      await qc.invalidateQueries({ queryKey: ['booking-settings', currentTeamId] })
      toast.success(t('toastSaved'))
    } catch (err) {
      console.error('[booking save] failed:', err)
      toast.error(err instanceof Error ? err.message : t('toastSaveFailed'))
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('pageSubtitle')}</p>
        </div>
      </div>

      {/* The save sits at the END of the form, not in the page header. It was
          the only header save in settings — default-size where every other one
          is small, and in a position nothing else used — so it read as a
          different kind of action from the save on the two policy cards
          directly below it. */}
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-5">
        <BookingForm
          control={control}
          register={register}
          customFieldDefinitions={customFieldDefinitions}
        />
        <SettingsSaveBar
          onSave={handleSubmit(onSubmit)}
          saving={isSubmitting}
          disabled={!isDirty}
        />
      </form>

      <div className="max-w-2xl space-y-4">
        <CancellationPolicyCard />
        <NoShowPolicyCard />
      </div>
    </div>
  )
}
