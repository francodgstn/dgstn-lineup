'use client'

// Thin client-component wrapper around next-themes' ThemeProvider. next-themes'
// ThemeProvider is a client component and (per its docs) must NOT be rendered
// directly inside a Server Component — the root layout is an async Server
// Component, so it renders this wrapper instead.

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps } from 'react'

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />
}
