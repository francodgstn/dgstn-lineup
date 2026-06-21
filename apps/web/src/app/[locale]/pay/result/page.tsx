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
  searchParams: Promise<{ status?: string; slug?: string; seg?: string }>
}) {
  const { status, slug, seg } = await searchParams
  const t = await getTranslations('PayResult')
  const success = status === 'success'
  // Course purchases land here with seg=space: success means a lifetime entitlement was
  // granted — point the buyer to their Space (where they watch) rather than the shop.
  const toSpace = seg === 'space'

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
        <p className="text-sm text-muted-foreground">
          {success ? (toSpace ? t('successBodyCourse') : t('successBody')) : t('cancelledBody')}
        </p>
        {slug ? (
          <Link
            href={`/public/${slug}/${success && toSpace ? 'space' : 'shop'}` as Route}
            className="inline-block text-sm font-medium text-primary hover:underline"
          >
            {success && toSpace ? t('openSpace') : t('backToShop')}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{t('close')}</p>
        )}
      </div>
    </div>
  )
}
