'use client'

// Linyup's OWN billing — the studio paying Linyup (plan checkout, cancel,
// reactivate, billing portal). This is NOT `useConnect.ts`: that file is the
// member → studio Connect rail, and the `failed-precondition` reasons its error
// mapper names ("Payment account setup is not complete", "No payment account")
// belong to a studio's Stripe Connect account and can never be thrown here.
//
// UX-5 (correction note, 2026-08-17). These four callables were raw inline
// `httpsCallable` calls in settings/billing/page.tsx, each of which caught its
// error, `console.error`d it and returned. The button un-spun, the page did not
// change, and **a cancel that failed looked exactly like a cancel that
// succeeded** until the next reload. They live here now so the error handling
// sits on the mutation DEFINITION — one place, inherited by any future caller
// (the org billing page at (auth)/org/[orgId]/billing still hand-rolls its own).
//
// Reasons are matched on the callable's CODE, not on its message substring:
// packages/functions/src/saas-billing/index.ts distinguishes its refusals by
// code (`resource-exhausted` for the 3-per-hour checkout limit,
// `permission-denied` for a non-owner, `not-found` for a missing subscription
// doc, `failed-precondition` for a doc with no Stripe id), and the messages are
// English server strings we would only have to re-translate.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import type { SaasPlan } from '@linyup/shared'

/** Where to send an owner whose subscription doc is missing its Stripe ids —
 *  the one refusal the server itself answers with "contact support". */
const SUPPORT_MAILTO = 'mailto:hello@linyup.com?subject=Billing%20help'

type SaasBillingAction = 'checkout' | 'cancel' | 'reactivate' | 'portal'

/** Per-action fallback: names what did NOT happen, so "it failed" and "it worked"
 *  can never look the same again. */
const FAILED_KEY: Record<SaasBillingAction, string> = {
  checkout: 'errorCheckout',
  cancel: 'errorCancel',
  reactivate: 'errorReactivate',
  portal: 'errorPortal',
}

/** The callable's error code without the SDK's `functions/` prefix ('' if none —
 *  e.g. the local URL guards below, which are plain Errors). */
function callableCode(err: unknown): string {
  const raw = (err as { code?: unknown } | null)?.code
  return typeof raw === 'string' ? raw.replace(/^functions\//, '') : ''
}

/**
 * Sibling of `usePaymentErrorToast` (Connect), deliberately not a reuse of it:
 * that hook maps two Connect-only messages and always attaches a
 * "Go to Settings → Payments" action — which on this page would send an owner
 * whose *Linyup* subscription failed to cancel into their *members'* payment
 * settings. Same shape, different rail, different next step.
 */
export function useSaasBillingErrorToast(action: SaasBillingAction) {
  const t = useTranslations('SaasBilling')

  return (err: unknown) => {
    const code = callableCode(err)

    // 'failed-precondition' is the only one the server itself answers with
    // "contact support" (the subscription doc exists but carries no Stripe
    // subscription/customer id) — so it is the only one that gets the action.
    if (code === 'failed-precondition') {
      toast.error(t('errorContactSupport'), {
        action: {
          label: t('contactSupport'),
          onClick: () => {
            window.location.href = SUPPORT_MAILTO
          },
        },
      })
      return
    }

    const key =
      code === 'permission-denied'
        ? 'errorOwnerOnly'
        : code === 'unauthenticated'
          ? 'errorSignedOut'
          : code === 'resource-exhausted'
            ? 'errorRateLimited'
            : code === 'not-found'
              ? 'errorNoSubscription'
              : FAILED_KEY[action]

    toast.error(t(key))
  }
}

/**
 * Plan checkout. Resolves by NAVIGATING to Stripe, so the caller's button stays
 * pending until the page unloads; every failure — including a checkout URL that
 * is not Stripe's — lands on the toast instead of a silent no-op.
 *
 * `locale` is passed so the server builds its success/cancel return URLs in the
 * owner's own language (it defaults to 'en' when absent).
 */
export function useCreateSaasCheckoutSession() {
  const onError = useSaasBillingErrorToast('checkout')
  const locale = useLocale()

  return useMutation({
    mutationFn: async ({ teamId, plan }: { teamId: string; plan: SaasPlan }) => {
      const fn = httpsCallable<{ teamId: string; plan: string; locale?: string }, { url: string }>(
        functions,
        'createCheckoutSession'
      )
      const url = (await fn({ teamId, plan, locale })).data.url
      if (
        !url.startsWith('https://checkout.stripe.com/') &&
        !url.startsWith('https://billing.stripe.com/')
      ) {
        throw new Error('Unexpected checkout URL')
      }
      window.location.href = url
      return url
    },
    onError,
  })
}

export function useCancelSaasSubscription() {
  const onError = useSaasBillingErrorToast('cancel')
  const t = useTranslations('SaasBilling')
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (teamId: string) => {
      const fn = httpsCallable<{ teamId: string }>(functions, 'cancelSaasSubscription')
      await fn({ teamId })
    },
    onSuccess: async (_data, teamId) => {
      toast.success(t('cancelSuccess'))
      await queryClient.invalidateQueries({ queryKey: ['saas-subscription', teamId] })
    },
    onError,
  })
}

export function useReactivateSaasSubscription() {
  const onError = useSaasBillingErrorToast('reactivate')
  const t = useTranslations('SaasBilling')
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (teamId: string) => {
      const fn = httpsCallable<{ teamId: string }>(functions, 'reactivateSaasSubscription')
      await fn({ teamId })
    },
    onSuccess: async (_data, teamId) => {
      toast.success(t('reactivateSuccess'))
      await queryClient.invalidateQueries({ queryKey: ['saas-subscription', teamId] })
    },
    onError,
  })
}

/** Stripe billing portal (update payment method). Navigates on success. */
export function useOpenBillingPortal() {
  const onError = useSaasBillingErrorToast('portal')

  return useMutation({
    mutationFn: async ({ teamId, returnUrl }: { teamId: string; returnUrl: string }) => {
      const fn = httpsCallable<{ teamId: string; returnUrl: string }, { url: string }>(
        functions,
        'getBillingPortalUrl'
      )
      const url = (await fn({ teamId, returnUrl })).data.url
      if (!url.startsWith('https://billing.stripe.com/')) throw new Error('Unexpected portal URL')
      window.location.href = url
      return url
    },
    onError,
  })
}
