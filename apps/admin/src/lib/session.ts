// Plain constants (no server-only): also imported by edge middleware.
// Firebase Hosting / App Hosting only forwards a cookie literally named
// `__session`, so the operator session must use that name to survive the CDN.
export const SESSION_COOKIE = '__session'
// 5 days, in milliseconds (Firebase session cookies allow 5min–2weeks).
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000
