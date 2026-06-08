'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Loader2 } from 'lucide-react'
import { isMagicLink, completeMagicLink } from '@/lib/auth'
import { userHasTeam } from '@/lib/provisioning'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const dynamic = 'force-dynamic'

type State = 'working' | 'need-email' | 'error'

export default function AuthFinishPage() {
  const router = useRouter()
  const t = useTranslations('Auth')
  const [state, setState] = useState<State>('working')
  const [email, setEmail] = useState('')

  async function complete(fallbackEmail?: string) {
    setState('working')
    try {
      const cred = await completeMagicLink(window.location.href, fallbackEmail)
      const hasTeam = await userHasTeam(cred.user.uid)
      router.replace(hasTeam ? '/dashboard' : '/signup')
    } catch (err) {
      if ((err as Error).message === 'missing-email') {
        setState('need-email')
      } else {
        setState('error')
      }
    }
  }

  useEffect(() => {
    if (!isMagicLink(window.location.href)) {
      setState('error')
      return
    }
    void complete()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex justify-center"><Logo size={32} /></div>

        {state === 'working' && (
          <div className="space-y-2">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t('finishing')}</p>
          </div>
        )}

        {state === 'need-email' && (
          <div className="space-y-3 text-left">
            <p className="text-sm text-muted-foreground text-center">{t('confirmEmailBody')}</p>
            <Label htmlFor="confirm-email">{t('emailLinkLabel')}</Label>
            <Input
              id="confirm-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && complete(email)}
            />
            <Button className="w-full" onClick={() => complete(email)}>
              {t('confirmEmailButton')}
            </Button>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{t('linkExpired')}</p>
            <Button variant="outline" onClick={() => router.replace('/login')}>
              {t('backToLogin')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
