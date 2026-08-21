/**
 * Where custom domains work — and, deliberately, where they do not.
 *
 * **Production only.** Not sandbox, not staging, not the local emulator.
 *
 * The constraint is structural rather than a policy choice: one Cloudflare zone
 * has ONE fallback origin, so every custom hostname on a zone reaches a single
 * backend. Serving prod and sandbox from one zone would need the edge to resolve
 * a hostname to an environment, which is exactly the lookup that does not exist
 * yet. Separating environments therefore means separate zones — a second
 * registered domain, a second token, a second Worker deploy.
 *
 * That is deferred, so until then the honest thing is to say so. A settings form
 * that accepts a domain on sandbox and then never serves it is worse than one
 * that explains why it is off: the studio does the DNS work, waits, and blames
 * the product. Decision recorded 2026-08-21 — Linyup advertises custom domains,
 * but demos and showcases run on the linyup.com URLs.
 *
 * ONE predicate, three callers (web card, operator console, the register
 * callable), each passing the project id its own runtime knows. Deriving it from
 * the Firebase project rather than a separate flag is the same reasoning as
 * `apps/web/src/app/robots.ts`: the project id cannot disagree with which
 * backend is actually being served.
 */

/** The only Firebase project where custom domains are wired to a Cloudflare zone. */
export const CUSTOM_DOMAIN_PROJECT = 'linyup-prod'

export function customDomainsAvailable(projectId: string | null | undefined): boolean {
  return projectId === CUSTOM_DOMAIN_PROJECT
}

/**
 * The refusal `registerPublicDomain` throws off-prod. A STABLE CODE, shared so
 * the client maps it to localized copy instead of showing the server's English —
 * and shared in BOTH directions, so renaming it breaks the reader rather than
 * silently degrading to a raw string. Mirrors MULTIPLE_USERS_PLAN_REFUSAL.
 */
export const CUSTOM_DOMAIN_ENV_REFUSAL = 'custom-domains-production-only'
