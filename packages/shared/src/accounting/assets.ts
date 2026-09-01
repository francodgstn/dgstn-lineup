// Indicative straight-line valuation for the asset register (types/asset.ts).
//
// PURE ARITHMETIC, NO POSTINGS — this is what the register page and the
// statement-of-assets report display in cash mode, and what the future accrual
// activation will read to compute NBV carry-ins. Whole-month granularity, like
// every period key in this ledger: the acquisition month is tranche 1, and
// month arithmetic runs on UTC calendar months (indicative values — a timezone
// edge shifts a display figure by one month at most, never a posting; the
// accrual engine will make its own, timezone-pinned call when postings exist).
//
// Rounding: accumulated depreciation at month m is floor(cost · m / life) —
// the remainder distributes across the schedule and the final month lands
// EXACTLY on cost, so a fully depreciated asset shows book value 0, not ±1
// Rappen of residue.

export interface AssetValuationInput {
  /** Original cost, integer minor units. */
  cost_minor: number
  /** Straight-line schedule length; values < 1 are treated as 1 (immediately
   * fully depreciated after the acquisition month). */
  useful_life_months: number
  /** Acquisition instant (ms). */
  acquired_at_ms: number
}

export interface AssetValuation {
  /** Whole months of the schedule consumed as of `asOfMs`, clamped to
   * [0, useful_life_months]. Acquisition month counts as 1. */
  months_elapsed: number
  /** Integer minor units. */
  accumulated_minor: number
  /** cost − accumulated, integer minor units. */
  book_value_minor: number
  fully_depreciated: boolean
}

/** UTC calendar-month index (year·12 + month) — the unit of the schedule. */
function monthIndex(ms: number): number {
  const d = new Date(ms)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/**
 * Value an asset as of an instant. For a DISPOSED asset pass its disposal
 * instant as `asOfMs` — the schedule stops there; the register does exactly
 * that when rendering disposed rows.
 */
export function assetBookValue(asset: AssetValuationInput, asOfMs: number): AssetValuation {
  const life = Math.max(1, Math.floor(asset.useful_life_months))
  const cost = Math.max(0, Math.floor(asset.cost_minor))
  const elapsedRaw = monthIndex(asOfMs) - monthIndex(asset.acquired_at_ms) + 1
  const months = Math.min(life, Math.max(0, elapsedRaw))
  const accumulated = Math.min(cost, Math.floor((cost * months) / life))
  return {
    months_elapsed: months,
    accumulated_minor: accumulated,
    book_value_minor: cost - accumulated,
    fully_depreciated: months >= life,
  }
}
