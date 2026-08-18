// Legacy path — Affiliations is a tab of the Plans & affiliations hub.
//
// Locale-aware, like the /team/* stubs: a bare target path drops a non-English
// visitor into the English app under `localePrefix: 'as-needed'`.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const target = '/offer/plans?tab=affiliations'
  redirect((locale === 'en' ? target : `/${locale}${target}`) as Route)
}
