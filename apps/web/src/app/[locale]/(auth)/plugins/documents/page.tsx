// Legacy path — Documents stopped being a plugin and moved to /documents. A
// default feature living under /plugins/ reads as an oversight. Locale-aware
// redirect so bookmarks and deep links keep working.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/documents' : `/${locale}/documents`) as Route)
}
