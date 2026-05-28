// Ported from hmd-lineup/functions/src/utils/dateFormatting.js
// Date formatting utilities for email templates. Default timezone: Europe/Zurich.

export const DEFAULT_TIMEZONE = 'Europe/Zurich'
export const DEFAULT_LOCALE = 'en-GB'

const LOCALE_MAP: Record<string, string> = {
  en: 'en-GB',
  it: 'it-IT',
  de: 'de-CH',
  fr: 'fr-CH',
}

export function getLocale(language = 'en'): string {
  return LOCALE_MAP[language] ?? LOCALE_MAP.en
}

export function formatDateLong(date: Date, language = 'en', timezone = DEFAULT_TIMEZONE): string {
  if (!date) return ''
  return date.toLocaleDateString(getLocale(language), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })
}

export function formatDateShort(date: Date, language = 'en', timezone = DEFAULT_TIMEZONE): string {
  if (!date) return ''
  return date.toLocaleDateString(getLocale(language), { year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })
}

export function formatDateNumeric(date: Date, language = 'en', timezone = DEFAULT_TIMEZONE): string {
  if (!date) return ''
  return date.toLocaleDateString(getLocale(language), { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone })
}

export function formatTime(date: Date, language = 'en', timezone = DEFAULT_TIMEZONE): string {
  if (!date) return ''
  return date.toLocaleTimeString(getLocale(language), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })
}

export function formatDateTime(date: Date, language = 'en', timezone = DEFAULT_TIMEZONE): string {
  if (!date) return ''
  return date.toLocaleString(getLocale(language), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })
}

export function formatTimestamp(date: Date, language = 'en', timezone = DEFAULT_TIMEZONE): string {
  if (!date) return ''
  return date.toLocaleString(getLocale(language), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })
}

export function formatDateForICal(date: Date): string {
  if (!date) return ''
  return date.toISOString().replace(/-|:|\.\d{3}/g, '').slice(0, -1) + 'Z'
}
