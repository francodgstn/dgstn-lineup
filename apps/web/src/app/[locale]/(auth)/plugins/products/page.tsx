// Legacy path — Products moved to the Offer section (/offer/products). Locale-aware redirect.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect((locale === 'en' ? '/offer/products' : `/${locale}/offer/products`) as Route)
}
