import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Linyup Ops',
  description: 'Internal operator console',
  robots: { index: false, follow: false },
}

// Applied before hydration so night mode never flashes white on load. Reads the
// saved choice, falling back to the OS preference on first visit.
const themeBootScript = `(function(){try{var t=localStorage.getItem('ops-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
