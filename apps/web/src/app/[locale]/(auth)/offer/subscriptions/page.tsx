// Legacy path — Subscriptions is a tab of the Plans & affiliations hub.
//
// Locale-aware, like the /team/* stubs: the previous version redirected to a bare
// `/offer/plans?tab=subscriptions`, which with `localePrefix: 'as-needed'` dropped
// a non-English visitor into the English app. /team/subscriptions redirects here,
// so that chain lost the locale too.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const target = '/offer/plans?tab=subscriptions'
  redirect((locale === 'en' ? target : `/${locale}${target}`) as Route)
}
