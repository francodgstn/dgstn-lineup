import type { EmailSenderConfig, SaasPlan } from '@linyup/shared'
import type { ResolvedSender } from './types'

// Pure sender-resolution logic — no I/O, fully unit-testable. Given a studio's
// already-fetched context, decide the From / display name / Reply-To.
//
// Rules (brief §2):
//  • Managed is the default for everyone and the automatic fallback whenever BYO
//    is not usable (no config / pending / failed / ineligible plan / no domain).
//  • BYO is used ONLY when the studio is on a paid plan, has a configured domain,
//    and Brevo reports it verified. We never put an unauthenticated third-party
//    domain in the From.

// BYO custom-domain sending is a paid feature (coach / studio / organization).
// Free studios always get Managed. (Managed itself is available to everyone.)
const BYO_ELIGIBLE_PLANS: readonly SaasPlan[] = ['coach', 'studio', 'organization']

export function isByoEligible(plan?: SaasPlan): boolean {
  return !!plan && BYO_ELIGIBLE_PLANS.includes(plan)
}

export interface StudioSenderInput {
  teamName: string
  // Studio contact email → Reply-To on both Managed and BYO sends.
  contactEmail?: string
  plan?: SaasPlan
  config?: EmailSenderConfig | null
  // The Linyup-controlled Managed From address (injected; see senderIdentity).
  managedFrom: string
}

export function resolveStudioSender(input: StudioSenderInput): ResolvedSender {
  const { teamName, contactEmail, plan, config, managedFrom } = input
  const displayName = teamName?.trim() || 'Linyup'
  const replyTo = contactEmail?.trim() || undefined

  const canByo =
    !!config &&
    config.model === 'byo_domain' &&
    config.verification_status === 'verified' &&
    !!config.domain &&
    isByoEligible(plan)

  if (canByo) {
    const localPart = (config!.from_local_part || 'info').trim() || 'info'
    return { name: displayName, email: `${localPart}@${config!.domain}`, replyTo }
  }

  // Managed fallback — the studio's name over a linyup.com address.
  return { name: displayName, email: managedFrom, replyTo }
}
