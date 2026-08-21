/**
 * Tenant router — the Cloudflare Worker behind every custom domain.
 *
 * It is the fallback origin for the `linyup.com` SaaS zone: a request to a
 * tenant's own hostname (`book.theirdojo.ch`) lands here, and this Worker maps
 * it onto the public route tree the Next.js app already serves.
 *
 *     book.theirdojo.ch/shop   →   <ORIGIN>/public/{slug}/shop
 *
 * Design docs: `docs/custom-domains.md`. Operator setup: `infra/README.md` §5d.
 * The path mapping itself lives in `paths.ts` and is unit-checked by
 * `scripts/check-paths.ts`.
 *
 * ─── PASS A (this file, today) ───────────────────────────────────────────────
 * `TENANT_SLUG` is a var, so one hostname maps to one hard-coded studio. That is
 * deliberate: it proves DNS → certificate → edge → Worker → App Hosting end to
 * end with nothing clever in the path. Get this working before adding lookup.
 *
 * ─── PASS B (next) ───────────────────────────────────────────────────────────
 * NOT `request.cf.hostMetadata` — that is Enterprise only. Creating a custom
 * hostname with `custom_metadata` on our plan fails with error 1413, verified
 * against the live zone on 2026-08-21. The replacement is an open decision
 * (Workers KV vs resolving in the app); see `docs/custom-domains.md`.
 *
 * Either way the slug is resolved on the ONE line marked below, which is why
 * that decision does not reach the rest of this file.
 */

import { isPassthrough, toInternalPath, toPublicPath } from './paths'

/** Zone hostnames that exist only to carry traffic — never a tenant destination. */
const PLUMBING_HOSTS = new Set(['origin.linyup.com', 'connect.linyup.com'])

interface Env {
  /** Base URL of the App Hosting backend, e.g. https://linyup-web--linyup-sandbox.europe-west4.hosted.app */
  ORIGIN: string
  /** PASS A only: the single studio slug this Worker serves. */
  TENANT_SLUG: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // An unhandled bug in here must not take the zone down. With this, an
    // exception forwards the request to the origin exactly as if no Worker were
    // present — the `*/*` route means a throw would otherwise 5xx every proxied
    // hostname at once.
    ctx.passThroughOnException()

    const url = new URL(request.url)
    const tenantHost = url.hostname

    // The route is `*/*`, so anything PROXIED on the zone lands here — including
    // the plumbing hostnames. `origin` and `connect` are not destinations: there
    // is no tenant to serve, and answering with a studio's page would put that
    // studio on a linyup.com URL nobody chose.
    if (PLUMBING_HOSTS.has(tenantHost) || tenantHost === new URL(env.ORIGIN).hostname) {
      return new Response('Not found', { status: 404 })
    }

    // Any OTHER linyup.com hostname reaching this Worker means somebody
    // orange-clouded a record that is meant to be DNS-only. It is NOT this
    // Worker's traffic, so it is forwarded to whatever that hostname's own DNS
    // record points at, untouched.
    //
    // THIS USED TO RETURN 503, AND THAT TOOK THE WHOLE ZONE DOWN (2026-08-21).
    // Every record in the zone was proxied by accident; without a Worker they
    // would all have kept working — Cloudflare would simply have forwarded to
    // App Hosting — but this refused them, so linyup.com, app, ops and demo went
    // down together. A `*/*` route makes every proxied record in the zone this
    // Worker's problem, so its default for anything it does not own has to be
    // "carry on", not "refuse".
    //
    // The same-zone fetch is safe: a Worker on a ROUTE cannot be the target of a
    // same-zone fetch(), so this reaches the origin instead of re-entering here.
    // (Cloudflare docs, workers/configuration/routing/routes.) Do not convert
    // this Worker to a Custom Domain without revisiting that — Custom Domains
    // CAN be same-zone fetch targets, which would make this an infinite loop.
    //
    // Proxying still silently breaks certificate renewal and flattens CNAMEs
    // (it broke DKIM that day), so the misconfiguration still has to be found —
    // that is `assertZoneRecordsUnproxied` in the daily tasks, not this line.
    if (tenantHost === 'linyup.com' || tenantHost.endsWith('.linyup.com')) {
      console.warn(
        `tenant-router: ${tenantHost} is PROXIED but should be DNS-only on the ` +
          `linyup.com zone — passing through to origin. Un-proxy that record.`,
      )
      return fetch(request)
    }

    const slug = env.TENANT_SLUG // PASS B resolves the slug HERE — see header
    if (!slug) return new Response('Tenant not configured', { status: 404 })

    const origin = new URL(env.ORIGIN)
    origin.pathname = isPassthrough(url.pathname)
      ? url.pathname
      : toInternalPath(url.pathname, slug)
    origin.search = url.search

    // `new Request(origin, request)` re-derives Host from the target URL, which
    // is what App Hosting needs to route to the right backend. The tenant's own
    // hostname is preserved separately so the app can build absolute URLs and
    // canonical tags pointing at the domain the visitor actually typed.
    const proxied = new Request(origin, request)
    proxied.headers.set('X-Linyup-Host', tenantHost)
    proxied.headers.set('X-Linyup-Slug', slug)

    // `manual` so redirects can be translated back into the tenant's namespace
    // rather than leaking the *.hosted.app origin into the address bar.
    const response = await fetch(proxied, { redirect: 'manual' })

    const location = response.headers.get('location')
    if (!location) return response

    const rewritten = new Response(response.body, response)
    try {
      const redirect = new URL(location, url)
      redirect.protocol = 'https:'
      redirect.hostname = tenantHost
      redirect.port = ''
      redirect.pathname = toPublicPath(redirect.pathname, slug)
      rewritten.headers.set('location', redirect.toString())
    } catch {
      // Unparseable Location — leave it exactly as the app sent it.
    }
    return rewritten
  },
} satisfies ExportedHandler<Env>
