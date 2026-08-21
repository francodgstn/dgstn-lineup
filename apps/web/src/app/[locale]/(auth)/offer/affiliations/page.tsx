// Legacy path — Affiliations is its own destination now, not a tab of the
// "Plans & affiliations" hub. Retargeted straight at it rather than bouncing
// through /offer/plans?tab=affiliations, which would be two redirects to reach
// one page.
//
// Locale-aware, like the /team/* stubs: a bare target path drops a non-English
// visitor into the English app under `localePrefix: 'as-needed'`.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const target = '/affiliations'
  redirect((locale === 'en' ? target : `/${locale}${target}`) as Route)
}
