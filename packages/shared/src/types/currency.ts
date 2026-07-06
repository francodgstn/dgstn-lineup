// Supported studio billing currencies. Deliberately a CURATED SUBSET of
// Stripe-supported currencies rather than the full list:
//  • every entry is a standard TWO-DECIMAL currency, so the app's minor-unit math
//    (amount × 100 = Rappen/cents) stays correct — zero-decimal (JPY, KRW) and
//    three-decimal (KWD, BHD) currencies would break it and are excluded on purpose;
//  • all are settlement/presentment currencies Stripe handles for the European +
//    major English-speaking markets Linyup targets today.
// Widen this list (not the math assumption) when a real customer needs another one.

export interface CurrencyOption {
  /** ISO 4217 code, uppercase — stored on teams/{id}.default_currency. */
  code: string
  /** English name shown in the picker. */
  name: string
  /** Currency symbol, for compact display. */
  symbol: string
}

export const SUPPORTED_CURRENCIES: readonly CurrencyOption[] = [
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
] as const

export const DEFAULT_CURRENCY = 'CHF'

const SUPPORTED_CODES: ReadonlySet<string> = new Set(SUPPORTED_CURRENCIES.map((c) => c.code))

/** True when `code` (case-insensitive) is one of the supported billing currencies. */
export function isSupportedCurrency(code: string | null | undefined): boolean {
  return !!code && SUPPORTED_CODES.has(code.toUpperCase())
}
