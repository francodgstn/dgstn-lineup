// Reserved team slugs.
//
// Team public surfaces live at tenant-first paths `/public/{slug}/…` where the
// first segment is the team slug. A handful of literal route segments sit at the
// same level (`/public/{slug}/booking`, `/public/event-invitation`, …); a team
// slug must never collide with one of them, or the literal route would shadow
// the tenant (or vice-versa). Slug validation (web + functions) rejects these.

// The census owner for the live segment list is `PublicRouteParams` in
// publicRoutes.ts — every key there is a literal segment under `/public/{slug}/`
// and therefore has to appear below. `publicRoutes.test.ts` asserts that
// correspondence, because this list drifted behind that one: `documents`,
// `waitlist`, `forms` and `kiosk` were all live routes that a team could still
// claim as its slug and shadow.
export const RESERVED_SLUGS: readonly string[] = [
  // sibling surfaces / sub-routes under the team root
  'booking',
  'signup',
  'membership-signup',
  'trial-booking',
  'contact-update',
  'appointments',
  'manage-booking',
  'space',
  'site',
  'shop',
  'documents',
  'waitlist',
  'forms',
  'kiosk',
  // RETIRED ROUTE, STILL RESERVED — deliberately, and it is the one entry below
  // with no matching key in `PublicRouteParams`. `/public/{slug}/waiver` was the
  // emailed guardian-signature landing page; the guardian machinery was removed
  // (see WaiverConfig.mayIncludeMinors), and the page went with it. Freeing the
  // word is a DATA decision rather than a cleanup: it is safe today, and it is
  // irreversible the moment one team claims it, at which point re-reserving it
  // means renaming somebody's public URLs. Nothing is gained by handing it out.
  'waiver',
  // token-only public routes that sit beside `/public/{slug}`
  'event-invitation',
  'team-invitation',
  // legacy context segment kept reserved for the back-compat redirect shims
  'bio-link',
]

const RESERVED_SET = new Set(RESERVED_SLUGS)

/** True when `slug` collides with a reserved literal route segment. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SET.has(slug.trim().toLowerCase())
}
