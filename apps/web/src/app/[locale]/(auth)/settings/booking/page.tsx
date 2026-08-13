'use client'

// Booking page settings — how the public /public/{slug}/booking flow behaves.
// Extracted out of the bio-link editor into its own "Configure" page. Saves the
// BookingSettings to public_profile.bookingSettings (source of truth, team-member
// writable) + mirrors to team.settings.booking (owner-only; re-hydrates this form).

import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useSaveShortcut } from '@/hooks/useSaveShortcut'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { TEAMS_COLLECTION } from '@linyup/shared'
import type { Team, BookingSettings } from '@linyup/shared'
import { NoShowPolicyCard } from './NoShowPolicyCard'
import { CancellationPolicyCard } from './CancellationPolicyCard'

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
    showActivityDescription: z.boolean(),
    showFitnessAppField: z.boolean(),
    ctaUrl: createSafeUrlSchema(t),
    ctaLabel: z.string().optional(),
    appointmentsEnabled: z.boolean().optional(),
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

function getDefaults(team: Team | null): FormData {
  const rawBooking = ((team?.settings as Record<string, unknown> | undefined)?.booking ??
    {}) as Record<string, unknown>
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
      showActivityDescription: rawBooking.showActivityDescription !== false,
      showFitnessAppField: rawBooking.showFitnessAppField === true,
      ctaUrl: typeof rawBooking.ctaUrl === 'string' ? rawBooking.ctaUrl : '',
      ctaLabel: typeof rawBooking.ctaLabel === 'string' ? rawBooking.ctaLabel : '',
      appointmentsEnabled: rawBooking.appointmentsEnabled === true,
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

function BookingForm({
  control,
  register,
}: {
  control: ReturnType<typeof useForm<FormData>>['control']
  register: ReturnType<typeof useForm<FormData>>['register']
}) {
  const t = useTranslations('SettingsBooking')
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

      {/* Booking window */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('windowTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('windowSubtitle')}</p>
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
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('cutoffTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('cutoffSubtitle')}</p>
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

      {/* Waitlist claim window. Sits under the cutoff on purpose — the cutoff is
          a hard clamp on it, so the two only make sense read together. */}
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

      {/* Toggles */}
      {(
        [
          {
            name: 'booking.showPhone' as const,
            label: t('toggleShowPhoneLabel'),
            desc: t('toggleShowPhoneDesc'),
          },
          {
            name: 'booking.showActivityDescription' as const,
            label: t('toggleShowActivityDescriptionLabel'),
            desc: t('toggleShowActivityDescriptionDesc'),
          },
          {
            name: 'booking.showFitnessAppField' as const,
            label: t('toggleShowFitnessAppLabel'),
            desc: t('toggleShowFitnessAppDesc'),
          },
          {
            name: 'booking.appointmentsEnabled' as const,
            label: t('toggleAppointmentsEnabledLabel'),
            desc: t('toggleAppointmentsEnabledDesc'),
          },
        ] as const
      ).map(({ name, label, desc }) => (
        <div key={name} className="flex items-center justify-between rounded-lg border p-3">
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
      ))}

      {/* CTA button */}
      <div className="space-y-3">
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
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function BookingSettingsPage() {
  const { currentTeamId } = useAuth()
  const { data: team, isLoading } = useTeam(currentTeamId)
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
    defaultValues: getDefaults(team ?? null),
  })

  useEffect(() => {
    if (team) reset(getDefaults(team))
  }, [team?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useSaveShortcut(() => {
    if (isDirty && !isSubmitting) handleSubmit(onSubmit)()
  })

  async function onSubmit(data: FormData) {
    if (!currentTeamId) return
    const bookingSettings: BookingSettings = {
      flowType: data.booking.flowType,
      windowMonths: data.booking.windowMonths,
      showPhone: data.booking.showPhone,
      showActivityDescription: data.booking.showActivityDescription,
      showFitnessAppField: data.booking.showFitnessAppField,
      ctaUrl: data.booking.ctaUrl || null,
      ctaLabel: data.booking.ctaLabel || null,
      appointmentsEnabled: data.booking.appointmentsEnabled ?? false,
      cutoffMinutes: data.booking.cutoffMinutes,
      waitlistClaimMinutes: data.booking.waitlistClaimMinutes,
    }
    try {
      // ① public_profile is the source of truth (team-member writable). Must succeed.
      const profileRef = doc(db, TEAMS_COLLECTION, currentTeamId, 'public_profile', currentTeamId)
      await setDoc(
        profileRef,
        { type: 'team', slug: team?.slug ?? '', name: team?.name ?? '', bookingSettings },
        { merge: true }
      )
      // ② Mirror onto the team doc (owner-only; re-hydrates this form). Non-fatal.
      updateDoc(doc(db, TEAMS_COLLECTION, currentTeamId), {
        'settings.booking': bookingSettings,
      }).catch((err) => {
        console.warn('[booking save] team doc update failed (non-fatal):', err)
      })
      await qc.invalidateQueries({ queryKey: ['team', currentTeamId] })
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
        <Button
          onClick={handleSubmit(onSubmit)}
          disabled={!isDirty || isSubmitting}
        >
          {isSubmitting ? t('saving') : t('save')}
        </Button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl">
        <BookingForm control={control} register={register} />
      </form>

      <div className="max-w-2xl space-y-4">
        <CancellationPolicyCard />
        <NoShowPolicyCard />
      </div>
    </div>
  )
}
