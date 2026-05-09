import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { getLocale } from 'next-intl/server'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Lineup',
  description: 'Team and session management for coaches, clubs, and organizations',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={geist.variable} suppressHydrationWarning>
      <body className="font-sans">{children}</body>
    </html>
  )
}
