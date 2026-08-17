'use client'

// UX-5: shared onError mapper for the money mutations in useConnect.ts and
// usePolicyFees.ts. requireChargeableAccount() (packages/functions/src/connect/access.ts)
// throws these two failed-precondition messages more than any other Connect
// refusal, on exactly the population most likely to be clicking these buttons —
// a studio mid-onboarding. Name the next step and link to Settings → Payments
// instead of failing silently. Wired on the mutation DEFINITIONS, not the call
// sites, so new callers inherit it for free.

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { Route } from 'next'
import { useRouter } from '@/i18n/navigation'

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : ''
}

export function usePaymentMutationErrorToast() {
  const t = useTranslations('PaymentErrors')
  const router = useRouter()

  return (err: unknown) => {
    const message = errorMessage(err)
    const bodyKey = message.includes('Payment account setup is not complete')
      ? 'setupIncomplete'
      : message.includes('No payment account')
        ? 'noAccount'
        : 'generic'
    toast.error(t(bodyKey), {
      action: {
        label: t('goToSettings'),
        onClick: () => router.push('/settings/team?tab=payments' as Route),
      },
    })
  }
}
