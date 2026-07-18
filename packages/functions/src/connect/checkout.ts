/* eslint-disable no-console */
// The ONE money core for Connect checkout callables. Every member→studio
// checkout (membership, product, course, drop-in, appointment, manager one-off)
// funnels its amount guarding, currency resolution, fee computation, result
// URLs, idempotency default and Stripe-error mapping through here — the five
// callables keep only their own business validation and metadata.
//
// The webhook contract is untouched by construction: metadata is built at each
// call site and passed through verbatim.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  MIN_CHARGE_MINOR,
  computePlatformFee,
  isChargeableMinorAmount,
  resolveStripeCurrency,
  takeRatePercent,
  toMinorUnits,
} from '@linyup/shared'
import {
  createOneOffCheckoutSession,
  createSubscriptionCheckoutSession,
} from '../utils/connect/client'
import { resolveBaseUrl } from '../utils/env'
import { requireChargeableAccount, type EnabledTeam } from './access'

// ─── Amount guards — ONE floor, ONE error shape ─────────────────────────────────
// Authored prices below Stripe's 0.50 floor are a configuration error → throw.
// (Arithmetic-derived prices clamp instead — see shared/utils/money.ts.)

function belowMinimumError(): HttpsError {
  return new HttpsError('failed-precondition', 'Amount is below the minimum charge of 0.50', {
    reason: 'below_minimum',
    min: MIN_CHARGE_MINOR,
  })
}

/** MAJOR-units price from stored config (e.g. 49.9) → integer Rappen, or throws. */
export function requireChargeableAmountFromMajor(major: unknown): number {
  if (typeof major !== 'number' || !Number.isFinite(major)) {
    throw new HttpsError('failed-precondition', 'A price is required', { reason: 'not_priced' })
  }
  const amount = toMinorUnits(major)
  if (!isChargeableMinorAmount(amount)) throw belowMinimumError()
  return amount
}

/** Already-minor amount (manager-entered Rappen) → validated, or throws. */
export function requireChargeableMinorAmount(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new HttpsError('failed-precondition', 'amount must be an integer in Rappen', {
      reason: 'not_integer',
    })
  }
  if (!isChargeableMinorAmount(amount)) throw belowMinimumError()
  return amount
}

// ─── Result URLs + idempotency ──────────────────────────────────────────────────

/** Default `pay/result` URLs (success/cancel), honouring caller overrides. */
export function buildResultUrls(
  locale: string,
  opts?: {
    successUrl?: string
    cancelUrl?: string
    /** Appended to the default result URLs so the page can link back (e.g. &slug=…&seg=shop). */
    extraQuery?: string
    /** Caller's origin — prefers localhost in dev, falls back to the hosting URL. */
    origin?: string
  }
): { successUrl: string; cancelUrl: string } {
  const base = `${resolveBaseUrl(opts?.origin)}/${locale}/pay/result`
  const extra = opts?.extraQuery ?? ''
  return {
    successUrl: opts?.successUrl ?? `${base}?status=success${extra}`,
    cancelUrl: opts?.cancelUrl ?? `${base}?status=cancelled${extra}`,
  }
}

/**
 * `${prefix}:${parts…}:${minuteBucket}` — the shared idempotency default. The
 * per-callable prefixes and part orders are load-bearing for Stripe retry dedup
 * across a deploy window — snapshot-tested, never reorder.
 */
export function defaultIdempotencyKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}:${Math.floor(Date.now() / 60_000)}`
}

// ─── Rate limit (moved verbatim from connect/payments.ts) ───────────────────────

const CHECKOUT_RATE_LIMIT_PER_HOUR = 30

/**
 * Index-free hourly rate limit for the public checkout: an `{ip}:{hourBucket}`
 * counter doc, incremented in a transaction. Avoids composite indexes (and the
 * emulator-hides-missing-index trap). 'unknown' IPs share one bucket.
 */
export async function checkoutRateLimit(ipRaw: string | undefined): Promise<void> {
  const ip = (ipRaw ?? 'unknown').replace(/[^\w.:-]/g, '_').slice(0, 60)
  const bucket = Math.floor(Date.now() / 3_600_000)
  const ref = admin.firestore().collection('connect_checkout_attempts').doc(`${ip}:${bucket}`)
  const count = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const next = ((snap.data()?.count as number | undefined) ?? 0) + 1
    tx.set(ref, { ip, bucket, count: next, updated_at: FieldValue.serverTimestamp() }, { merge: true })
    return next
  })
  if (count > CHECKOUT_RATE_LIMIT_PER_HOUR) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Please try again later.')
  }
}

// ─── Checkout orchestrators ─────────────────────────────────────────────────────

/** One-off direct charge: account gate → currency → platform fee → Checkout
 *  Session, with the unified error mapping. Metadata passes through verbatim. */
export async function startOneOffCheckout(params: {
  team: EnabledTeam
  amountMinor: number
  productName: string
  successUrl: string
  cancelUrl: string
  customerEmail?: string
  metadata: Record<string, string>
  idempotencyKey: string
  expiresAtEpochSeconds?: number
  /** Log tag, e.g. 'createProductCheckout'. */
  label: string
}): Promise<{ url: string; sessionId: string; applicationFeeAmount: number }> {
  const { team, amountMinor } = params
  const { accountId, model } = requireChargeableAccount(team)
  const applicationFeeAmount = computePlatformFee({ tier: team.plan, amount: amountMinor, model })
  try {
    const session = await createOneOffCheckoutSession({
      accountId,
      amount: amountMinor,
      currency: resolveStripeCurrency(team.data.default_currency as string | undefined),
      applicationFeeAmount,
      productName: params.productName,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerEmail: params.customerEmail,
      metadata: params.metadata,
      idempotencyKey: params.idempotencyKey,
      expiresAtEpochSeconds: params.expiresAtEpochSeconds,
    })
    return { url: session.url, sessionId: session.sessionId, applicationFeeAmount }
  } catch (err) {
    console.error(`[connect] ${params.label} failed:`, err)
    throw new HttpsError('internal', 'Failed to start checkout')
  }
}

/** Recurring subscription on the connected account: fee per invoice via
 *  application_fee_percent. Same shell as startOneOffCheckout. */
export async function startSubscriptionCheckout(params: {
  team: EnabledTeam
  amountMinor: number
  interval: 'day' | 'week' | 'month' | 'year'
  intervalCount?: number
  productName: string
  successUrl: string
  cancelUrl: string
  customerEmail?: string
  metadata: Record<string, string>
  idempotencyKey: string
  label: string
}): Promise<{ url: string; sessionId: string; applicationFeePercent: number }> {
  const { team } = params
  const { accountId } = requireChargeableAccount(team)
  const applicationFeePercent = takeRatePercent(team.plan)
  try {
    const session = await createSubscriptionCheckoutSession({
      accountId,
      amount: params.amountMinor,
      currency: resolveStripeCurrency(team.data.default_currency as string | undefined),
      interval: params.interval,
      intervalCount: params.intervalCount,
      applicationFeePercent,
      productName: params.productName,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerEmail: params.customerEmail,
      metadata: params.metadata,
      idempotencyKey: params.idempotencyKey,
    })
    return { url: session.url, sessionId: session.sessionId, applicationFeePercent }
  } catch (err) {
    console.error(`[connect] ${params.label} failed:`, err)
    throw new HttpsError('internal', 'Failed to start checkout')
  }
}
