'use client'

// Shared "new guest" details form — firstname/lastname/email/phone(+ optional
// fitness-aggregator select) — used by both the class BookingForm ('details'
// step) and the appointment picker's booking modal. Moved out of
// BookingForm.tsx verbatim (same fields, same zod schema, same markup);
// parameterized so each caller controls submit-button rendering and error text.
//
// BookingForm triggers the submit from its sticky bar (outside the <form>
// element) — the forwarded ref exposes an imperative `submit()` for that.

import { forwardRef, useImperativeHandle, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslations } from 'next-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const FITNESS_APPS = ['Fitpass', 'ClassPass', 'Urban Sports Club', 'Gymlib', 'Wellhub', 'Other']

export function createNewGuestSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    firstname: z.string().min(1, t('errorRequired')).max(60),
    lastname: z.string().min(1, t('errorRequired')).max(60),
    email: z.string().email(t('errorInvalidEmail')),
    phone: z.string().max(30).optional(),
    aggregatorApp: z.string().optional(),
  })
}

export type GuestDetailsValues = z.infer<ReturnType<typeof createNewGuestSchema>>

export interface GuestDetailsFormHandle {
  /** Imperatively triggers validation + submit — used by BookingForm's sticky
   *  bar Confirm button, which lives outside this component's <form>. */
  submit: () => void
}

export interface GuestDetailsFormProps {
  showPhone: boolean
  showAggregatorField?: boolean
  submitting: boolean
  error?: string | null
  onSubmit: (values: GuestDetailsValues) => void | Promise<void>
  /** When set, renders a visible full-width submit button with this label
   *  (appointment picker use — a modal with no sticky bar). When omitted, the
   *  submit button is sr-only and must be triggered externally via the
   *  forwarded ref (BookingForm's sticky-bar Confirm button does this). */
  submitLabel?: string
  /** Label shown on the visible submit button while `submitting` is true.
   *  Defaults to the generic "Booking…" copy. Only relevant when `submitLabel`
   *  is set. */
  submittingLabel?: string
  accentColor?: string | null
}

export const GuestDetailsForm = forwardRef<GuestDetailsFormHandle, GuestDetailsFormProps>(
  function GuestDetailsForm(
    { showPhone, showAggregatorField, submitting, error, onSubmit, submitLabel, submittingLabel, accentColor },
    ref
  ) {
    const t = useTranslations('PublicBooking')
    const schema = useMemo(() => createNewGuestSchema(t), [t])
    const form = useForm<GuestDetailsValues>({ resolver: zodResolver(schema) })

    useImperativeHandle(ref, () => ({
      submit: () => {
        form.handleSubmit(onSubmit)()
      },
    }))

    return (
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('labelFirstName')} <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              {...form.register('firstname')}
              autoComplete="given-name"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {form.formState.errors.firstname && (
              <p className="text-xs text-destructive">{form.formState.errors.firstname.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('labelLastName')} <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              {...form.register('lastname')}
              autoComplete="family-name"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {form.formState.errors.lastname && (
              <p className="text-xs text-destructive">{form.formState.errors.lastname.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">
            {t('labelEmail')} <span className="text-destructive">*</span>
          </label>
          <input
            type="email"
            {...form.register('email')}
            autoComplete="email"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>

        {showPhone && (
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('labelPhone')} <span className="text-muted-foreground font-normal">{t('optionalSuffix')}</span>
            </label>
            <input
              type="tel"
              {...form.register('phone')}
              autoComplete="tel"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}

        {showAggregatorField && (
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('labelFitnessApp')} <span className="text-muted-foreground font-normal">{t('optionalSuffix')}</span>
            </label>
            <Controller
              name="aggregatorApp"
              control={form.control}
              render={({ field }) => (
                <Select
                  value={field.value || '__none__'}
                  onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('notUsingFitnessApp')}</SelectItem>
                    {FITNESS_APPS.map((app) => (
                      <SelectItem key={app} value={app}>
                        {app}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {submitLabel ? (
          <button
            type="submit"
            disabled={submitting}
            style={accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 text-sm"
          >
            {submitting ? (submittingLabel ?? t('ctaBooking')) : submitLabel}
          </button>
        ) : (
          // Hidden submit — triggered externally (e.g. BookingForm's sticky bar).
          <button type="submit" className="sr-only" aria-hidden="true">
            {t('srOnlySubmit')}
          </button>
        )}
      </form>
    )
  }
)
