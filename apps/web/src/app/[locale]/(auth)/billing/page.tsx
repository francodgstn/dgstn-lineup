// Legacy path — settings moved under /settings/*. Redirect (locale-aware) so old
// links and bookmarks keep working.
//
// The QUERY STRING is carried across, and that is not cosmetic: the SaaS checkout
// callable sends Stripe back to `{host}/{locale}/billing?checkout=success`
// (packages/functions/src/saas-billing/index.ts), so this redirect is on the
// return path of every plan purchase. Dropping the query dropped the
// `CheckoutBanner` on /settings/billing with it — an owner who had just paid
// landed on a page that said nothing about it.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  const search = await searchParams

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') query.append(key, value)
    else if (Array.isArray(value)) for (const v of value) query.append(key, v)
  }
  const qs = query.toString()
  const suffix = qs ? `?${qs}` : ''

  redirect(
    (locale === 'en'
      ? `/settings/billing${suffix}`
      : `/${locale}/settings/billing${suffix}`) as Route
  )
}
