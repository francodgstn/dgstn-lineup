// Legacy path — the course editor moved under the Offer section. Locale-aware
// redirect that preserves the courseId.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>
}) {
  const { locale, courseId } = await params
  const to = `/offer/online-courses/${courseId}`
  redirect((locale === 'en' ? to : `/${locale}${to}`) as Route)
}
