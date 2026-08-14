import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Fredoka, Sora } from 'next/font/google'
import { getLocale } from 'next-intl/server'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  weight: ['600', '700'],
  display: 'swap',
})

const fredoka = Fredoka({
  subsets: ['latin'],
  variable: '--font-fredoka',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

// Only production is indexable. Staging (app-stg.linyup.com) and the demo
// sandbox (demo.linyup.com) are real subdomains with real certificates, so they
// are crawlable by default and would otherwise compete with linyup.com in
// search — and put half-finished copy in front of strangers.
//
// Derived from the Firebase project rather than a separate flag, so it cannot
// drift from which backend the app is actually talking to. Next renders this as
// `<meta name="robots" content="noindex, nofollow">`; the matching robots.txt
// lives in robots.ts, since a meta tag alone only helps on pages a crawler has
// already fetched.
const isProduction = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'linyup-prod'

export const metadata: Metadata = {
  title: 'Linyup',
  description: 'Team and session management for coaches, clubs, and organizations',
  ...(isProduction ? {} : { robots: { index: false, follow: false } }),
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${jakarta.variable} ${sora.variable} ${fredoka.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
