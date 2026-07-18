// Persist an EXPLICIT language choice.
//
// next-intl resolves the active locale in this order: (1) a locale prefix in
// the URL, (2) the NEXT_LOCALE cookie, (3) the Accept-Language header, (4) the
// default locale. With `localePrefix: 'as-needed'` the default locale (en) is
// the one WITHOUT a prefix — so switching to English produces a bare
// `/dashboard`, step 1 finds nothing, and the browser's Accept-Language wins.
// An Italian-preferring browser is then redirected straight back to
// `/it/dashboard`, and English is unreachable no matter how often it's picked.
// Non-default locales never show this: their prefix wins at step 1.
//
// Writing the cookie puts the user's choice at step 2, ahead of the browser's
// preference. First-time visitors still get auto-detection (which matters on the
// public booking/bio-link pages), but once someone chooses, the choice sticks.
//
// Name must match next-intl's default cookie, since `routing.ts` doesn't
// override `localeCookie`.
export const LOCALE_COOKIE = 'NEXT_LOCALE'

const ONE_YEAR_SECONDS = 31_536_000

export function persistLocale(locale: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}
