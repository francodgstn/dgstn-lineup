'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { useRouter } from '@/i18n/navigation'
import { signIn } from '@/lib/auth'
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode } from '@/lib/demo'
import { Logo } from '@/components/Logo'

export const dynamic = 'force-dynamic'

/**
 * Embedded live preview entry point (used by the landing page's iframe).
 * Signs into a demo team — `?team=<key>` or a random one — and lands on the
 * dashboard. Standalone visitors can use it too; it's just a fast lane into
 * the same demo accounts as /try.
 */
function PreviewSplash({ failed }: { failed: boolean }) {
  const t = useTranslations('Try')
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/40 px-4">
      <Logo size={28} />
      {failed ? (
        <>
          <p className="text-sm text-muted-foreground">{t('previewFailed')}</p>
          <a
            href="/try"
            target="_top"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('openDemo')}
          </a>
        </>
      ) : (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t('entering')}
        </p>
      )}
    </div>
  )
}

function PreviewInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const key = params.get('team')
    const account =
      DEMO_ACCOUNTS.find((a) => a.key === key) ??
      DEMO_ACCOUNTS[Math.floor(Math.random() * DEMO_ACCOUNTS.length)]
    signIn(account.email, DEMO_PASSWORD)
      .then(() => router.replace('/dashboard'))
      .catch(() => setFailed(true))
  }, [params, router])

  return <PreviewSplash failed={failed} />
}

export default function PreviewPage() {
  // Demo playground is sandbox/local only — hidden everywhere else.
  if (!isDemoMode()) notFound()

  return (
    <Suspense fallback={<PreviewSplash failed={false} />}>
      <PreviewInner />
    </Suspense>
  )
}
