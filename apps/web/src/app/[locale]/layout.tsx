import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { AuthProvider } from '@/contexts/AuthContext'
import QueryProvider from '@/contexts/QueryProvider'
import { Toaster } from '@/components/ui/sonner'
import { routing } from '@/i18n/routing'
import { PostHogProvider } from '@/components/providers/PostHogProvider'
import { AppCheckInit } from '@/components/providers/AppCheckProvider'
import { TooltipProvider } from '@/components/ui/tooltip'

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
          {/* ONE provider for every `Tip` in the app. It owns the SHARED delay,
              which is the point: moving between two icon controls should open
              the second instantly rather than waiting again, and that only
              happens when both read the same provider. A few components still
              mount their own; nesting is harmless, and they can drop theirs
              whenever they are next touched. */}
          <TooltipProvider delay={300}>
            <AuthProvider>{children}</AuthProvider>
          </TooltipProvider>
        </QueryProvider>
        <Toaster richColors position="top-right" />
      </PostHogProvider>
    </NextIntlClientProvider>
  )
}
