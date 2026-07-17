const dateFmt = new Intl.DateTimeFormat('en-CH', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

const chfFmt = new Intl.NumberFormat('en-CH', {
  style: 'currency',
  currency: 'CHF',
  maximumFractionDigits: 0,
})

const dateTimeFmt = new Intl.DateTimeFormat('en-CH', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDate(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return dateFmt.format(new Date(ms))
}

export function formatDateTime(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return dateTimeFmt.format(new Date(ms))
}

export function formatChf(amount: number): string {
  return chfFmt.format(amount)
}

export function daysUntil(ms: number | null | undefined, nowMs: number): number | null {
  if (ms == null) return null
  return Math.ceil((ms - nowMs) / 86_400_000)
}
