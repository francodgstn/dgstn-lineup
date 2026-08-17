// Legacy path — the document editor moved out of /plugins/ when Documents
// stopped being a plugin. Locale-aware redirect that preserves the documentId.
import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; documentId: string }>
}) {
  const { locale, documentId } = await params
  const to = `/documents/${documentId}`
  redirect((locale === 'en' ? to : `/${locale}${to}`) as Route)
}
