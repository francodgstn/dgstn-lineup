import type { PublicSurface, SystemLinkTarget } from './types/team'

// ─── Public tenant routes ─────────────────────────────────────────────────────
//
// The ONE place that knows the shape of `/public/{slug}/…`. Lives in @linyup/shared
// (not apps/web) because packages/functions builds these URLs for emails too and
// cannot import `Route` from next — when the contract lived only in the web app,
// the two drifted: `sendBookingCancelled` and `updateSession` have been emailing
// `…/booking?activity={id}` for months and the booking page never read the param.
//
// Layering:
//   publicPath / publicUrl        (here)          — pure strings, no framework
//   publicHref / publicHrefLocalized (apps/web)   — next-intl + typedRoutes wrappers
//
// Params are serialized in ALPHABETICAL key order so the same call always yields
// the same string (idempotency keys, snapshot tests, email diffs).

/**
 * Routable public paths. This is deliberately WIDER than `PublicSurface`:
 * `PublicSurface` is the set a team may pick as its default landing surface
 * (`Team.default_public_surface`) and is depended on by `ActivePublicSurfaces`
 * and the root page's redirect — do not widen it. These extra entries are
 * reachable routes that are never a landing.
 */
export type PublicRoutable =
  | PublicSurface
  | 'appointments'
  | 'appointments/cancel'
  | 'manage-booking'
  | 'waitlist'
  | 'contact-update'
  | 'trial-booking'
  | 'forms'

/** `/public/{slug}/booking` — see the booking deep-link contract in BookingForm. */
export interface BookingParams {
  /** Session id. Highest precedence: lands the visitor on the "who's booking" step. */
  session?: string
  /** Activity id (NOT the slug — the slug form is the `/booking/{activitySlug}` path). */
  activity?: string
  /** `YYYY-MM-DD`. Only meaningful once an activity is resolved. */
  date?: string
  /** Referral code, carried through to `bookSession({ referralCode })`. */
  referral?: string
  /** Where the visitor came from — resolves the back link. See `returnHref`. */
  from?: PublicFrom
}

/** `/public/{slug}/appointments` */
export interface AppointmentParams {
  activity?: string
  /** Provider (coach) id. */
  provider?: string
  date?: string
  /** Duration in minutes. */
  duration?: number
  from?: PublicFrom
}

export interface ShopParams {
  tab?: 'subscriptions' | 'products' | 'courses'
  /** Subscription type id — opens that plan. */
  type?: string
  course?: string
  from?: PublicFrom
}

export interface SignupParams {
  from?: PublicFrom
  email?: string
}

export interface TokenParams {
  token?: string
}

export interface ContactUpdateParams {
  contactId?: string
  from?: PublicFrom
}

export interface FromOnlyParams {
  from?: PublicFrom
}

/**
 * `?from=` values. Every `PublicSurface` plus `'checkout'` (the Stripe return,
 * which is not a surface a visitor can go "back" to). Unknown values are not an
 * error — `returnHref` falls back to the team's default surface.
 */
export type PublicFrom = PublicSurface | 'checkout'

/** Per-route param types, so `publicPath(slug, 'booking', { … })` is checked. */
export interface PublicRouteParams {
  'bio-link': FromOnlyParams
  site: FromOnlyParams
  space: FromOnlyParams
  booking: BookingParams
  shop: ShopParams
  signup: SignupParams
  documents: FromOnlyParams
  kiosk: Record<string, never>
  appointments: AppointmentParams
  'appointments/cancel': TokenParams
  'manage-booking': TokenParams
  /** Both waitlist tokens land here — the page decides which mode to render by
   *  which one the server matched, so the link shape stays identical whether it
   *  came from a join confirmation or from an offer. */
  waitlist: TokenParams
  'contact-update': ContactUpdateParams
  'trial-booking': BookingParams
  forms: FromOnlyParams
}

type ParamValue = string | number | undefined | null

/** Alphabetical, undefined/null/'' dropped, values encoded. Empty → ''. */
export function publicQuery(params?: Record<string, ParamValue>): string {
  if (!params) return ''
  const parts: string[] = []
  for (const key of Object.keys(params).sort()) {
    const value = params[key]
    if (value === undefined || value === null || value === '') continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/**
 * Path only, no origin, no locale prefix.
 *
 * `'bio-link'` is the team ROOT (`/public/{slug}`), not a sibling route — it
 * renders inline there. Omitting `route` means the same thing.
 */
export function publicPath<R extends PublicRoutable>(
  slug: string,
  route?: R,
  params?: PublicRouteParams[R]
): string {
  const base = route && route !== 'bio-link' ? `/public/${slug}/${route}` : `/public/${slug}`
  return `${base}${publicQuery(params as Record<string, ParamValue> | undefined)}`
}

/**
 * Same, with extra path segments — for the dynamic sub-routes
 * (`booking/{activitySlug}`, `documents/{slug}`, `space/courses/{slug}`, …).
 * Segments are encoded individually.
 */
export function publicSubPath<R extends PublicRoutable>(
  slug: string,
  route: R,
  sub: string | string[],
  params?: PublicRouteParams[R]
): string {
  const segments = (Array.isArray(sub) ? sub : [sub]).filter(Boolean).map(encodeURIComponent)
  const base = `/public/${slug}/${route}${segments.length ? `/${segments.join('/')}` : ''}`
  return `${base}${publicQuery(params as Record<string, ParamValue> | undefined)}`
}

/**
 * Absolute URL. This is the form packages/functions uses for emailed links —
 * always with `getHostingUrl()` as the origin, never a request host.
 */
export function publicUrl<R extends PublicRoutable>(
  origin: string,
  slug: string,
  route?: R,
  params?: PublicRouteParams[R]
): string {
  return `${origin}${publicPath(slug, route, params)}`
}

/** Absolute variant of `publicSubPath`. */
export function publicSubUrl<R extends PublicRoutable>(
  origin: string,
  slug: string,
  route: R,
  sub: string | string[],
  params?: PublicRouteParams[R]
): string {
  return `${origin}${publicSubPath(slug, route, sub, params)}`
}

/**
 * Structured form of `SYSTEM_LINK_META[t].route` (types/team.ts), which is a
 * pre-baked string that may carry a query (`'shop?tab=subscriptions'`).
 *
 * That literal stays the source of truth — it is stored/consumed data read by
 * `BioLinkHome` and the bio-link editor. This table is the structured mirror, so
 * new call sites can go through `publicPath` instead of string-concatenating a
 * route that already contains a `?`. `publicRoutes.test.ts` asserts the two agree.
 */
export const SYSTEM_LINK_ROUTE: Record<
  SystemLinkTarget,
  { route: PublicRoutable; params?: ShopParams }
> = {
  booking: { route: 'booking' },
  signup: { route: 'signup' },
  shop: { route: 'shop' },
  'shop-subscriptions': { route: 'shop', params: { tab: 'subscriptions' } },
  'shop-products': { route: 'shop', params: { tab: 'products' } },
  'shop-courses': { route: 'shop', params: { tab: 'courses' } },
  space: { route: 'space' },
  site: { route: 'site' },
  documents: { route: 'documents' },
}

/** The set `?from=` accepts. Anything else is ignored rather than rejected. */
const PUBLIC_FROM_VALUES: readonly PublicFrom[] = [
  'bio-link',
  'site',
  'space',
  'booking',
  'shop',
  'signup',
  'documents',
  'kiosk',
  'checkout',
]

/** Narrow an untrusted `?from=` query value. */
export function parsePublicFrom(value: string | undefined | null): PublicFrom | undefined {
  if (!value) return undefined
  return (PUBLIC_FROM_VALUES as readonly string[]).includes(value)
    ? (value as PublicFrom)
    : undefined
}

// ─── Untrusted query-param parsers ───────────────────────────────────────────
//
// Everything the public routes read out of a URL is attacker-supplied: a malformed
// link can be sent to a victim, so the value has to be shaped BEFORE it reaches a
// Firestore path, an href, a date constructor or the render tree.
//
// These narrow to `undefined` rather than throwing — a bad param degrades the
// deep link, it never breaks the page.

/**
 * A Firestore document id used as a PATH SEGMENT.
 *
 * The important rule is no `/`: `doc(db, 'sessions', id, 'public_profile', id)`
 * splits its arguments on slashes, so an id like `a/b/c` silently addresses a
 * DIFFERENT document than the caller intended. Also rejects `.`/`..` (path
 * traversal), the reserved `__x__` form, and anything over Firestore's limit.
 */
export function parseDocId(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  if (value.length > 1500) return undefined
  if (value === '.' || value === '..') return undefined
  if (value.includes('/')) return undefined
  if (/^__.*__$/.test(value)) return undefined
  // Ids we mint are url-safe; anything else is not ours and has no business in a path.
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined
  return value
}

/** A `YYYY-MM-DD` day key, rejecting impossible dates (`2026-13-45`). */
export function parseDateKey(value: string | undefined | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  const probe = new Date(Date.UTC(y, m - 1, d))
  // Round-trip catches 2026-02-30 and friends, which Date silently rolls over.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d)
    return undefined
  return value
}

/** A tenant/course/activity slug appearing in a path segment. */
export function parseSlug(value: string | undefined | null): string | undefined {
  if (!value || value.length > 200) return undefined
  return /^[a-z0-9][a-z0-9-]*$/i.test(value) ? value : undefined
}

/** A positive integer query value (`?duration=`), bounded to keep it sane. */
export function parsePositiveInt(
  value: string | undefined | null,
  max = Number.MAX_SAFE_INTEGER
): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 && n <= max ? n : undefined
}
