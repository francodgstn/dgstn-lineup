// Legacy path — Places moved to /schedule/places, beside the calendar that reads
// it (UX-67). Redirect (locale-aware) so old links, bookmarks and any stored
// shortcut keep working.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/schedule/places' : `/${locale}/schedule/places`) as Route)
}
