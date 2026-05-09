import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { AuthProvider } from '@/contexts/AuthContext'
import QueryProvider from '@/contexts/QueryProvider'
import { routing } from '@/i18n/routing'
import '../globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Lineup',
  description: 'Team and session management for coaches, clubs, and organizations',
}

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
    <html lang={locale} className={geist.variable}>
      <body className="font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
