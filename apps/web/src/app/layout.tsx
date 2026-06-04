import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Barlow_Condensed } from 'next/font/google'
import { getLocale } from 'next-intl/server'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const barlow = Barlow_Condensed({
  subsets: ['latin'],
  variable: '--font-barlow',
  weight: ['600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Linyup',
  description: 'Team and session management for coaches, clubs, and organizations',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${jakarta.variable} ${barlow.variable}`} suppressHydrationWarning>
      <body className="font-sans">{children}</body>
    </html>
  )
}
