// The comparison is over. This page WAS the from-scratch alternative to the
// incumbent dashboard; it won, and its body now lives at /dashboard. The route
// stays as a redirect because the sidebar advertised it for a week — a bookmark
// or an open tab should land on the page it was looking at, not a 404.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/dashboard' : `/${locale}/dashboard`) as Route)
}
