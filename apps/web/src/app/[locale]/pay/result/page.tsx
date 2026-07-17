import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { CheckCircle2, XCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Stripe Checkout success/cancel landing (member → studio Connect payments). Lives
// outside /public/[slug] so it must not use usePublicTeam; a `slug` query param
// (set by the checkout callable) lets it link back to the team's shop.
export default async function PayResultPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; slug?: string; seg?: string; email?: string }>
}) {
  const { status, slug, seg, email } = await searchParams
  const t = await getTranslations('PayResult')
  const success = status === 'success'
  // Course purchases land with seg=space — point the buyer to their Space (where they
  // watch). A 'full' membership lands with seg=signup so the buyer finishes their
  // registration (consent + the studio's required fields). Both only on success.
  const toSpace = success && seg === 'space'
  const toSignup = success && seg === 'signup'
  // Drop-in bookings land with seg=booking — point the buyer back to the booking page.
  const toBooking = success && seg === 'booking'
  // Paid appointments land with seg=appointments — point the buyer back to the picker.
  const toAppointments = success && seg === 'appointments'

  // Primary CTA target + label.
  let ctaHref = `/public/${slug}/shop`
  let ctaLabel = t('backToShop')
  if (toSpace) {
    ctaHref = `/public/${slug}/space`
    ctaLabel = t('openSpace')
  } else if (toSignup) {
    ctaHref = `/public/${slug}/signup?from=checkout${email ? `&email=${encodeURIComponent(email)}` : ''}`
    ctaLabel = t('completeRegistration')
  } else if (toBooking) {
    ctaHref = `/public/${slug}/booking`
    ctaLabel = t('backToBooking')
  } else if (toAppointments) {
    ctaHref = `/public/${slug}/appointments`
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
