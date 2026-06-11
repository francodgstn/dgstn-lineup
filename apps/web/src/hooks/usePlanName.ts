'use client'

import { useTranslations } from 'next-intl'
import type { SaasPlan } from '@linyup/shared'

/**
 * Single source for plan DISPLAY names.
 *
 * Plan IDs ('free' | 'coach' | 'studio' | 'organization') are stable machine
 * identifiers — they live in Firestore (`teams/{teamId}.plan`), security rules
 * and Stripe lookup keys, and must NEVER change. Marketing names live only in
 * the `Plans` namespace of `messages/{locale}.json` (e.g. the 'studio' tier is
 * currently sold as "Studio"). To rename a plan, edit the four message files —
 * do not touch plan IDs and do not hardcode plan names in components.
 */
export function usePlanName(): (plan: SaasPlan) => string {
  const t = useTranslations('Plans')
  return (plan) => t(plan)
}
