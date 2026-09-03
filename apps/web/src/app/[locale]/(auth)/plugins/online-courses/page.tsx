// Legacy path — Online courses moved to the Offer section (/manage/online-courses).
// Locale-aware redirect so bookmarks/deep links keep working.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/manage/online-courses' : `/${locale}/manage/online-courses`) as Route)
}
