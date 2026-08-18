// Legacy path — Places moved to /schedule/places (UX-67). This stub used to point
// at /settings/places; it now points at the real page directly rather than
// bouncing through a second redirect.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/schedule/places' : `/${locale}/schedule/places`) as Route)
}
