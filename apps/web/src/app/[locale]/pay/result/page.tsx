import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { CheckCircle2, XCircle } from 'lucide-react'
import { parseSlug } from '@linyup/shared'
import { publicHref } from '@/lib/publicRoutes'
import { RestoreBookingReturn } from './RestoreBookingReturn'

export const dynamic = 'force-dynamic'

// Stripe Checkout success/cancel landing (member → studio Connect payments). Lives
// outside /public/[slug] so it must not use usePublicTeam; a `slug` query param
// (set by the checkout callable) lets it link back to the team's shop.
export default async function PayResultPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; slug?: string; seg?: string; email?: string }>
}) {
  const { status, slug: rawSlug, seg, email } = await searchParams
  const t = await getTranslations('PayResult')
  const success = status === 'success'
  // This page is reachable with any query — Stripe redirects here, but so does a
  // hand-crafted link. `slug` is interpolated into the CTA href below, so shape it
  // rather than trusting the round-trip: an unparseable slug just hides the CTA.
  const slug = parseSlug(rawSlug)
  // Course purchases land with seg=space — point the buyer to their Space (where they
  // watch). A 'full' membership lands with seg=signup so the buyer finishes their
  // registration (consent + the studio's required fields). Both only on success.
  const toSpace = success && seg === 'space'
  const toSignup = success && seg === 'signup'
  // Drop-in bookings land with seg=booking — point the buyer back to the booking page.
  const toBooking = success && seg === 'booking'
  // Paid appointments land with seg=appointments — point the buyer back to the picker.
  const toAppointments = success && seg === 'appointments'

  // Primary CTA target + label. Built through the shared route helper so the
  // slug can only ever land in a path segment and params are encoded once.
  let ctaHref: Route = publicHref(slug ?? '', 'shop')
  let ctaLabel = t('backToShop')
  if (toSpace) {
    ctaHref = publicHref(slug ?? '', 'space')
    ctaLabel = t('openSpace')
  } else if (toSignup) {
    ctaHref = publicHref(slug ?? '', 'signup', { from: 'checkout', email })
    ctaLabel = t('completeRegistration')
  } else if (toBooking) {
    ctaHref = publicHref(slug ?? '', 'booking', { from: 'checkout' })
    ctaLabel = t('backToBooking')
  } else if (toAppointments) {
    ctaHref = publicHref(slug ?? '', 'appointments', { from: 'checkout' })
    ctaLabel = t('backToAppointments')
  }

  const body = success
    ? toSpace
      ? t('successBodyCourse')
      : toSignup
        ? t('successBodySignup')
        : toBooking
          ? t('successBodyBooking')
          : toAppointments
            ? t('successBodyAppointment')
            : t('successBody')
    : t('cancelledBody')

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        {success ? (
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
        ) : (
          <XCircle className="mx-auto h-12 w-12 text-muted-foreground" />
        )}
        <h1 className="text-xl font-semibold">
          {success ? t('successTitle') : t('cancelledTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        {/* Booking payments came from a flow that may have been running as an
            overlay on the studio's website — put the buyer back there. Falls
            through to the static CTA below when there's nothing to restore. */}
        {toBooking && <RestoreBookingReturn />}
        {slug ? (
          <Link
            href={ctaHref as Route}
            className="inline-block text-sm font-medium text-primary hover:underline"
          >
            {ctaLabel}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{t('close')}</p>
        )}
      </div>
    </div>
  )
}
