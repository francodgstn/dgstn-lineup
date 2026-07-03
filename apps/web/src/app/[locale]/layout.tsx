import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { AuthProvider } from '@/contexts/AuthContext'
import QueryProvider from '@/contexts/QueryProvider'
import { Toaster } from '@/components/ui/sonner'
import { routing } from '@/i18n/routing'
import { PostHogProvider } from '@/components/providers/PostHogProvider'
import { AppCheckInit } from '@/components/providers/AppCheckProvider'

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  const messages = await getMessages()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PostHogProvider>
        <AppCheckInit />
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
        <Toaster richColors position="top-right" />
      </PostHogProvider>
    </NextIntlClientProvider>
  )
}
