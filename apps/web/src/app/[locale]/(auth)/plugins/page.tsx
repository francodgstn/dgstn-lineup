// Legacy path — the plugins hub moved into the settings shell (/settings/plugins)
// so it renders in the settings detail area. Redirect (locale-aware). The per-plugin
// sub-routes (/plugins/website, /plugins/online-courses, …) stay here.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/settings/plugins' : `/${locale}/settings/plugins`) as Route)
}
