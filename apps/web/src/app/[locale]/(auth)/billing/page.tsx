// Legacy path — settings moved under /settings/*. Redirect (locale-aware) so old
// links and bookmarks keep working.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/settings/billing' : `/${locale}/settings/billing`) as Route)
}
