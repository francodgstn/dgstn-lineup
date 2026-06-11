// Shared formatting helpers.

// Formats a decimal amount (e.g. 49.9, NOT cents) in the given ISO 4217 currency.
// Used for subscription-type prices in the editor, contact assignment, and the
// public website pricing table.
export function formatCurrency(amount: number, currency: string, locale = 'de-CH'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: (currency || 'CHF').toUpperCase(),
  }).format(amount)
}
