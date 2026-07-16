// Reserved team slugs.
//
// Team public surfaces live at tenant-first paths `/public/{slug}/…` where the
// first segment is the team slug. A handful of literal route segments sit at the
// same level (`/public/{slug}/booking`, `/public/event-invitation`, …); a team
// slug must never collide with one of them, or the literal route would shadow
// the tenant (or vice-versa). Slug validation (web + functions) rejects these.

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
