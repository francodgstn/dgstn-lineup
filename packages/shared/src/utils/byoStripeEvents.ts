// BYO Stripe — is this endpoint delivering BOTH event families?
//
// THE DEFECT THIS ANSWERS (docs/open-defects.md → "A BYO studio can double-count
// its own recurring revenue"): under the current Stripe API an `invoice.*`
// payload can no longer name its PaymentIntent and a `payment_intent.*` /
// `charge.*` payload can no longer name its invoice, and the BYO rail holds no
// credentials with which to bridge them. A studio whose endpoint is subscribed
// to BOTH families therefore gets TWO `payment_events` rows for one recurring
// payment, and nothing on our side can merge them.
//
// WHAT THIS FUNCTION IS, AND IS NOT:
//
//   • It is a READING of what the endpoint actually delivered. `raw_status` on
//     a recorded row is the literal `event.type` that wrote it, so "both
//     families arrived" is a stored FACT, not an inference.
//   • It is NOT a duplicate matcher. It never claims that row A and row B are
//     the same money — that would need amount/time guessing, and a wrong match
//     would delete or merge a real second payment. Nothing here mutates
//     anything; the caller's only permitted action is to TELL the studio.
//
// Franco's decision, 2026-08-18: guidance + detection is the close for this
// defect. Dedupe-by-heuristic was rejected, and so was giving the rail
// credentials (avoiding them is what BYO is FOR).

/** Which half of the divide an event type belongs to. */
export type ByoStripeEventFamily = 'payment' | 'invoice'

/**
 * Events that record a row keyed on the PAYMENT itself. `charge.succeeded` is
 * deliberately absent: it is enrich-only and never writes a row, so it never
 * appears as a row's `raw_status`.
 */
export const BYO_STRIPE_PAYMENT_EVENTS = [
  'payment_intent.succeeded',
  'checkout.session.completed',
] as const

/**
 * The family a recorded row's `raw_status` belongs to, or null when the string
 * is something this rail does not record (a Payrexx status, a manual row, an
 * event type added later).
 *
 * The invoice side is matched by PREFIX rather than by a list: any `invoice.*`
 * event that ever records a row keys on the invoice for the same reason, and a
 * list here would silently stop warning the day one is added.
 */
export function byoStripeEventFamily(
  rawStatus: string | null | undefined
): ByoStripeEventFamily | null {
  const t = (rawStatus ?? '').trim()
  if (!t) return null
  if ((BYO_STRIPE_PAYMENT_EVENTS as readonly string[]).includes(t)) return 'payment'
  if (t.startsWith('invoice.')) return 'invoice'
  return null
}

/** The subset of a `payment_events` row this reading needs. */
export interface ByoStripeEventRow {
  /** ExternalPayment.gateway — only `'stripe'` rows are read. */
  gateway?: string | null
  /** ExternalPayment.raw_status — the literal Stripe event type that wrote it. */
  raw_status?: string | null
  /** ExternalPayment.processed_at as epoch ms, or null when unreadable. */
  processedAtMs?: number | null
}

export interface ByoStripeDoubleRecordingSignal {
  /**
   * Both families were delivered inside the window ⇒ every recurring payment in
   * it was written down twice. The ONLY claim this module makes.
   */
  bothFamilies: boolean
  paymentRows: number
  invoiceRows: number
  lastPaymentAtMs: number | null
  lastInvoiceAtMs: number | null
  /** The exact invoice event types seen, sorted — so a warning can name them. */
  invoiceEventTypes: string[]
  /** The window the counts were taken over, echoed back for the copy. */
  windowDays: number
}

export const BYO_DUPLICATION_WINDOW_DAYS = 90

/**
 * Read a page of `payment_events` rows and say whether the team's BYO Stripe
 * endpoint is delivering both event families.
 *
 * BOUNDED BY A WINDOW, deliberately: rows are permanent, so an unbounded read
 * would keep accusing an endpoint the studio has already fixed. A window makes
 * the warning SELF-CLEARING — once the invoice events stop, it ages out — and
 * costs nothing in the case that matters, because a subscription that renews
 * monthly reappears inside any window worth warning about.
 *
 * Undated rows are ignored rather than counted: a row that cannot be placed in
 * the window cannot support a claim about the window.
 *
 * @param rows recent rows, any order (the caller usually has them newest-first)
 */
export function detectByoStripeDoubleRecording(
  rows: ByoStripeEventRow[],
  opts?: { nowMs?: number; windowDays?: number }
): ByoStripeDoubleRecordingSignal {
  const windowDays = opts?.windowDays ?? BYO_DUPLICATION_WINDOW_DAYS
  const nowMs = opts?.nowMs ?? Date.now()
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000

  let paymentRows = 0
  let invoiceRows = 0
  let lastPaymentAtMs: number | null = null
  let lastInvoiceAtMs: number | null = null
  const invoiceEventTypes = new Set<string>()

  for (const row of rows) {
    if ((row.gateway ?? null) !== 'stripe') continue
    const at = row.processedAtMs ?? null
    if (at == null || at < cutoff) continue
    const family = byoStripeEventFamily(row.raw_status)
    if (family === 'payment') {
      paymentRows += 1
      if (lastPaymentAtMs == null || at > lastPaymentAtMs) lastPaymentAtMs = at
    } else if (family === 'invoice') {
      invoiceRows += 1
      invoiceEventTypes.add((row.raw_status ?? '').trim())
      if (lastInvoiceAtMs == null || at > lastInvoiceAtMs) lastInvoiceAtMs = at
    }
  }

  return {
    bothFamilies: paymentRows > 0 && invoiceRows > 0,
    paymentRows,
    invoiceRows,
    lastPaymentAtMs,
    lastInvoiceAtMs,
    invoiceEventTypes: [...invoiceEventTypes].sort(),
    windowDays,
  }
}
