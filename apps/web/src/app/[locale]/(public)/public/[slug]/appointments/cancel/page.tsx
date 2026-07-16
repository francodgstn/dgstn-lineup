'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { CalendarX, Check, AlertCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

type State = 'idle' | 'cancelling' | 'done' | 'error'

export default function AppointmentCancelPage() {
  const t = useTranslations('AppointmentCancel')
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!token) setState('error')
  }, [token])

  async function handleCancel() {
    if (!token) return
    setState('cancelling')
    try {
      // Shared cancellation callable (there is no separate appointment one) —
      // token-based, releases the appointment slot and emails the confirmation.
      const fn = httpsCallable(functions, 'cancelBooking')
      await fn({ token })
      setState('done')
    } catch (err) {
      const e = err as { code?: string }
      if (e.code === 'not-found') setErrorMsg(t('errorNotFound'))
      else if (e.code === 'failed-precondition') setErrorMsg(t('errorPastSlot'))
      else setErrorMsg(t('errorGeneric'))
      setState('error')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-sm w-full text-center space-y-5">
        {(state === 'idle' || state === 'cancelling') && token && (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <CalendarX className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-bold">{t('title')}</h1>
              <p className="text-sm text-muted-foreground">{t('message')}</p>
            </div>
            <Button
              onClick={handleCancel}
              disabled={state === 'cancelling'}
              variant="destructive"
              className="w-full"
            >
              {state === 'cancelling' ? t('cancelling') : t('confirm')}
            </Button>
          </>
        )}

        {state === 'done' && (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold">{t('cancelledTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('cancelledMessage')}</p>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="text-xl font-bold">{t('errorTitle')}</h1>
            <p className="text-sm text-muted-foreground">
              {errorMsg || (token ? t('errorGeneric') : t('errorNoToken'))}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
