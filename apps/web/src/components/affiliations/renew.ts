import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

// Shared helpers for the "renew affiliation" action (single + bulk). Renew extends
// an affiliation's validity window and flips it back to active — reversing the daily
// expiry task. No payment is processed; any fee is paid directly to the issuer.

export interface RenewAffiliationArgs {
  teamId: string
  contactId: string
  affiliationId: string
  months?: number
  /** Optional display-only "issuer fee received" flag. */
  fee_paid?: boolean
}

export interface RenewAffiliationResult {
  id: string
  status_id: string
  active: boolean
  valid_until: number // millis
}

/** Call the renewAffiliation callable for a single affiliation. */
export async function renewAffiliationCall(
  args: RenewAffiliationArgs,
): Promise<RenewAffiliationResult> {
  const fn = httpsCallable<RenewAffiliationArgs, RenewAffiliationResult>(functions, 'renewAffiliation')
  const res = await fn(args)
  return res.data
}

/** Add `months` calendar months to a date, clamping day overflow (Jan 31 + 1 month
 *  → last day of Feb, not Mar 3). Mirrors the backend addMonths so the previewed
 *  new-expiry date matches what renewAffiliation will store. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const target = d.getMonth() + months
  d.setMonth(target)
  if (d.getMonth() !== ((target % 12) + 12) % 12) d.setDate(0)
  return d
}

/** Compute the new expiry a renew would produce: extend from the later of now / the
 *  current expiry by the type's default validity (fallback 12 months). */
export function previewRenewedUntil(
  currentValidUntil: Date | null | undefined,
  defaultValidityMonths: number | null | undefined,
): Date {
  const now = new Date()
  const base =
    currentValidUntil && currentValidUntil.getTime() > now.getTime() ? currentValidUntil : now
  return addMonths(base, defaultValidityMonths && defaultValidityMonths > 0 ? defaultValidityMonths : 12)
}
