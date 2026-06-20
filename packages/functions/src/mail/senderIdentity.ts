import { defineString } from 'firebase-functions/params'
import type { ResolvedSender } from './types'

// The system + managed-studio sender identities, env-backed so the two streams
// can later be moved onto separate subdomains for reputation isolation WITHOUT
// touching any call site (brief §3 — "do not hardcode a single shared identity").
//
//  - System mail (password reset, verification, receipts, platform notices) is
//    sent as `hello@linyup.com`.
//  - Managed studio mail is sent from a Linyup-controlled address on linyup.com
//    with the studio's *name* as the display name and the studio's contact email
//    as Reply-To (the From address itself is set here).
const systemFrom = defineString('MAIL_SYSTEM_FROM', {
  description: 'From address for Linyup system mail',
  default: 'hello@linyup.com',
})
const systemName = defineString('MAIL_SYSTEM_NAME', {
  description: 'Display name for Linyup system mail',
  default: 'Linyup',
})
const managedStudioFrom = defineString('MAIL_MANAGED_STUDIO_FROM', {
  description: 'From address for Managed (non-BYO) studio mail on linyup.com',
  default: 'studios@linyup.com',
})

export function getSystemSender(): ResolvedSender {
  return { name: systemName.value(), email: systemFrom.value() }
}

export function getManagedStudioFrom(): string {
  return managedStudioFrom.value()
}
