# Custom domains ("bring your own domain")

A studio's public surfaces live at `linyup.com/public/{slug}/…` — bio-link, site,
booking, shop, documents, space, events, appointments. This feature serves that
same tree from a hostname the studio owns, with the slug segment gone.

## Status (2026-08-21)

**The registration rail is built; the serving rail is not.** A studio can connect
a domain and watch it go live at Cloudflare — but a request to it does not yet
reach their pages, because the edge cannot yet tell which tenant a hostname
belongs to (see "How the edge learns…" below, which is the one open decision).

Built:

- `registerPublicDomain` / `checkPublicDomain` / `removePublicDomain`
  (`packages/functions/src/domains/`), plus the Cloudflare client.
- `PublicDomainConfig` + the `public_domains/{hostname}` uniqueness registry,
  with rules denying every client write (including the owner — see below).
- Studio UI: Settings → Team, directly under the email sender card.
- Operator console: Settings → Domains — the platform token, and every connected
  domain across all tenants.
- `refreshCustomDomains` in `dailyTasks`.
- The edge Worker, `infra/workers/tenant-router/`.

Not built, and each is load-bearing before this can be announced: the edge
tenant lookup, per-tenant emailed links (`teamPublicBaseUrl`), the Stripe return
origin check, `proxy.ts` host handling, and the canonical/301 policy. They are
described under "What this breaks in the app" below.

Verified end to end on 2026-08-21 against `book.hmdbasel.ch`: hostname `active`,
certificate `active`, TLS verifying — the DNS → certificate → edge path works.

## The shape

**One hostname per tenant, serving the WHOLE public tree.** Not one hostname per
surface. `book.theirdojo.ch/` is their default surface, `/shop` is the shop,
`/space` the member portal.

The reason is not tidiness — it is that **a subdomain is a separate origin and the
contact's session is origin-scoped**. Public contact sign-in is
`signInWithCustomToken`, persisted in Firebase Auth's IndexedDB plus a
localStorage flag (`PublicContactAuthProvider`), both keyed by origin. Splitting
booking and shop across two hosts means a member signs in twice, with two
passwordless email codes, to book a class and buy a T-shirt. Nothing recovers
that: Auth persistence is not cookie-scoped, and a token handoff on cross-host
navigation puts session tokens in URLs.

Extra hostnames are therefore **aliases that 301 into the primary** —
`shop.theirdojo.ch` → `theirdojo.ch/shop` — handled at the edge, never reaching
Next.js. A studio still gets the short host for a flyer or a QR code; the visitor
lands on one origin and stays there. Model the data as a LIST of hostnames with
exactly one primary from day one (the edge supports it for free), even though v1
may only expose one.

**Subdomains, not apex, in v1.** An apex cannot CNAME; it needs ALIAS/ANAME or
CNAME-flattening, which many registrars (Swiss ones especially) do not offer. This
is less of a compromise than it sounds: the common case is a studio keeping an
existing website on the apex and wanting only the transactional surfaces from us.
HMD Basel is exactly this — `hmdbasel.ch` is on GitHub Pages and is not moving.

**Suggest `book.`** as the prefilled default (`my.` as the visible alternative).
It names the action rather than the software, is four characters, and reads in all
four national languages. The field stays free text — a studio wanting
`buchen.theirdojo.ch` types it.

## Why Cloudflare

Firebase App Hosting custom domains are a manual Console/CLI operation per domain
against a Google-managed cert (`infra/README.md`, §5b/§6). Fine for our three
domains; there is no self-service path there.

**Cloudflare for SaaS** (custom hostnames) is built for this: one API call
registers a tenant hostname, Cloudflare issues and renews the cert. First 100
hostnames free, then $0.10/hostname/month.

**The SaaS zone is `linyup.com` itself** (decided 2026-08-21): move its DNS from
OVH to Cloudflare — registrar stays OVH, only the nameservers change — and give
tenants **`connect.linyup.com`** as their CNAME target.

**That target string is effectively irreversible.** Once studios have it in their
DNS, changing it means asking every one of them to edit a record, and the ones who
don't go dark. So it is chosen for the long run, not for convenience now.

Two alternatives were considered and rejected:

- **Delegating `sites.linyup.com` to Cloudflare while the rest stays at OVH** —
  not available: that is a child-zone setup and Cloudflare gates it to
  **Enterprise** (`dns/zone-setups/subdomain-setup/`: Free/Pro/Business all "No").
- **A separate single-purpose domain** (`linyup.app`) as the SaaS zone, leaving
  `linyup.com` on OVH. Rejected after examination: it buys only the *deferral* of
  an hour of DNS work, and costs a permanent second dependency whose lapsed
  registration would break every tenant's domain at once. The security argument
  for it does not survive contact with the facts — a token scoped to custom
  hostnames (`SSL and Certificates: Edit`) **cannot edit DNS records**, so the mail
  records were never reachable from this feature either way. `connect.linyup.com`
  is also the more legible target for a studio's IT person, and the move brings
  Cloudflare's WAF/analytics in front of the marketing site, which is wanted
  eventually regardless. (`linyup.app` may still be registered as brand defence —
  parked, no role here.)

**Moving the zone is not proxying it.** Every pre-existing record stays
**grey-cloud / DNS-only**, where Cloudflare is a plain authoritative host and MX,
SPF/DKIM/DMARC and the App Hosting records behave exactly as at OVH. Only the two
new records (`origin`, `connect`) are proxied. Migration preconditions are in
`infra/README.md` §5d — the one that actually bites is DNSSEC.

Traffic path:

```
visitor → theirdojo.ch
        → Cloudflare edge (custom hostname, CF-issued cert)
        → fallback origin = a Worker
             reads request.cf.hostMetadata → { teamId, slug, … }
             rewrites  /booking → /public/{slug}/booking
             fetch() to the App Hosting host, original host preserved in a header
        → Next.js on App Hosting, route tree unchanged
```

**The wildcard route makes every proxied record in the zone this Worker's
problem — so its default for anything it does not own is "carry on".** Learned
on 2026-08-21: every proxyable `linyup.com` record was orange-clouded at once,
and the Worker *refused* the ones it did not recognise, taking the apex, `app`,
`ops` and `demo` down together. Without a Worker they would have kept working —
Cloudflare would simply have forwarded to App Hosting. A guard turned a
degradation into an outage.

It now forwards an unknown `linyup.com` host to that hostname's own origin
(`fetch(request)`, safe because a Worker on a ROUTE cannot be the target of a
same-zone fetch — do not convert it to a Custom Domain without revisiting that),
and calls `ctx.passThroughOnException()` so a bug in the Worker degrades to "as
if no Worker" rather than 5xx-ing the zone.

That fixes availability and hides the mistake, which is why the other half
exists: proxying **flattens a CNAME**, so that day it also broke DKIM (every
outbound mail lost DMARC alignment) and flattened the five
`_acme-challenge_*` certificate authorizations. Neither fails loudly.
`assertZoneRecordsUnproxied` (daily tasks) is the alarm — it uses
`origin.linyup.com` as the reference for "what proxied looks like", so it tracks
Cloudflare's addressing instead of hardcoding IP ranges. **The invariant was
previously enforced by a comment, and the comment lost.**

**The Worker needs a `*/*` route, not a route on the fallback origin.** Worker
routes match the REQUEST hostname, so `origin.linyup.com/*` never fires for
`book.theirdojo.ch` — designating a Worker as the fallback origin is not enough
by itself, and the symptom is a 522 on the tenant domain while `origin` itself
answers fine. Cloudflare's documented answer is the wildcard, which captures
every request entering the zone with no per-tenant route ever. **That is only
safe because every `linyup.com` record is DNS-only** — a wildcard route reaches
proxied hostnames only. See the ⚠ in `infra/README.md` §5d and in
`wrangler.jsonc`; the Worker answers 503 naming the cause if it is ever handed
one of our own hostnames.

**How the edge learns which tenant a hostname belongs to is an OPEN DECISION**,
because the obvious answer is not available to us. Cloudflare's `custom_metadata`
(read at the edge as `request.cf.hostMetadata`) would carry `{teamId, slug}` on
the hostname record itself — no second store, no sync job. It is **Enterprise
only**: creating a hostname with it on our plan fails with

```
1413  No custom metadata access has been allocated for this zone or account.
```

verified against the live zone on 2026-08-21. The two workable alternatives:

- **Workers KV** — the Worker reads `host:{hostname}` → `{teamId, slug}`;
  `registerPublicDomain` writes it when a domain verifies. Fast and edge-local,
  but it is a second store, and this repo has a strong preference against
  anything that can go stale (see the dynamic contact groups note in CLAUDE.md).
- **Resolve in the app** — the Worker stops rewriting paths and becomes a pure
  host-preserving proxy; `proxy.ts` resolves host→slug from Firestore (REST, with
  an in-process TTL cache) and rewrites there. One source of truth, nothing to
  sync. Costs a lookup per instance per domain, and moves the rewrite into the
  app.

Leaning towards the second: the app **already** needs the host→tenant mapping for
emailed links, canonical URLs and the Stripe origin check, so having the edge keep
its own copy buys little and can disagree with the app's.

## Environments — PRODUCTION ONLY

**Custom domains work on `linyup-prod` and nowhere else.** Not sandbox, not
staging, not the emulator. The predicate is `customDomainsAvailable(projectId)`
(`packages/shared/src/utils/customDomains.ts`), derived from the Firebase project
id for the same reason `robots.ts` is — the project id cannot disagree with which
backend is actually being served.

The constraint is structural, not a policy choice: **one Cloudflare zone has one
fallback origin**, so every custom hostname on a zone reaches a single backend.
Serving prod and sandbox from one zone would need the edge to resolve a hostname
to an *environment*, which is the same lookup that does not exist yet. Real
separation therefore means separate zones — a second registered domain, a second
token, a second Worker deploy — and that is deferred.

So the honest thing is to say so, in three places, rather than let a form accept
a domain that will never be served:

- the studio card renders one sentence instead of the form
  (`CustomDomain.unavailable*`);
- the operator console replaces the token field with the reason — an operator
  staring at a bare "not configured" badge would go hunting for a missing secret;
- **`registerPublicDomain` refuses server-side** (`CUSTOM_DOMAIN_ENV_REFUSAL`).
  That is the enforcement; the UI is only the explanation. Without it a sandbox
  tenant reaches Cloudflare and registers a hostname on the PRODUCTION zone — the
  zone id and token are per-environment params, but "unset" is one
  misconfiguration away from "set to prod's".

`check` and `remove` stay open deliberately, so a domain connected before a
project was reclassified can still be inspected and cleaned up rather than
stranded by the guard meant to prevent strandings.

**The product consequence, agreed 2026-08-21: Linyup advertises custom domains,
but never showcases them on demo/sandbox/staging.** Lead demos and the `/try`
playground run on linyup.com URLs.

## Per-tenant flow

Model it on the BYO **email** domain feature, which is the same problem solved
once already (`packages/functions/src/mail/domainAuth.ts`,
`packages/functions/src/mail/README.md` → "BYO domain flow"):

- Config at `teams|organizations/{id}/integrations/public_domain`, the sibling of
  `EmailSenderConfig` — status, hostname, CF hostname id, DNS records to display,
  `last_checked_at`. No credentials.
- Global uniqueness registry `public_domains/{hostname}` (doc-id IS the hostname,
  like `promo_codes`), so two tenants cannot claim one host. Callables only, and
  **unreadable by clients too** — it is a list of every studio's domain, so a
  readable registry would let any signed-in user enumerate the customer base.
- **The `integrations/{id}` rules had to be narrowed**, and this is the
  non-obvious part: that block granted an owner blanket write over every
  integration doc, which would have included `public_domain`. Firestore ORs all
  matching rules, so a more specific deny cannot override a broader allow — the
  owner's write is therefore excluded by condition
  (`integrationId != 'public_domain'`) on both the team and org blocks. Without
  it a studio could write another studio's hostname into their own config, which
  matters the moment anything resolves an incoming hostname by reading it.
- **Teardown**: the claim is registered in `TENANT_DATA_COLLECTIONS` (matched on
  `entityId`) because a claim outliving its tenant locks that hostname forever —
  including against the same studio signing up again. Deleting it does not delete
  the Cloudflare hostname, so it carries `externalTeardown: 'cloudflare_hostname'`
  and `purgeTeam` warns.
- `registerPublicDomain` / `checkPublicDomain` / `removePublicDomain`, guarded by
  `assertTeamOwner` / `assertOrgAdmin` and a plan check mirroring `isByoEligible`.
- The studio adds **one CNAME**. With HTTP validation, ownership and cert issuance
  both fall out of that record resolving — no separate TXT step in the common case.
- Status polls in `dailyTasks` plus a manual "Check now". **A silently dead domain
  is the worst failure mode here** — Cloudflare deactivates a hostname whose CNAME
  disappears, and the studio must be told.

## What this breaks in the app — the real cost

The edge work is contained. The app-side work is wide and quiet, and its failure
mode is "everything works except the emails":

1. **Emailed links.** `getHostingUrl()` is one global param used at ~39 call sites
   across 25 files (booking confirmations, .ics, waitlist claims, manage-booking,
   Space). All funnel through `publicUrl` / `localizedPublicUrl`, so the fix is one
   new resolver — `teamPublicBaseUrl(teamId)` — threaded in, not 39 rewrites.
   **Not optional**: a studio on their own domain whose confirmations say
   linyup.com is worse off than before.
2. **Stripe return origin.** `resolveBaseUrl` (`utils/env.ts`) validates the caller
   origin against a hardcoded `*.linyup.com` regex. It must check against **that
   tenant's verified domain** — widening the regex is an open redirect.
3. **Redirect host in `proxy.ts`.** It already rebuilds `Location` from
   `x-forwarded-host` to fix the Cloud Run `:8080` leak. If the Worker sets `Host`
   to the App Hosting hostname, locale redirects land on `*.hosted.app`. The Worker
   must preserve the original host and `proxy.ts` must prefer it.
4. **Canonical + 301.** Once live, `linyup.com/public/{slug}/*` should 301 to the
   custom domain — it stops us competing with our own customers in search, which is
   the point of the feature. Keep the linyup path alive forever: it is baked into
   old emails, .ics files and QR codes. Canonical is already host-derived
   (`site/page.tsx`), but the path still carries `/public/{slug}`.
5. Per-host `robots.ts` / sitemap (currently keyed on the prod project id only).

**Two things pleasantly do NOT break.** Public contact sign-in uses
`signInWithCustomToken`, which is not subject to Firebase Auth's authorized-domains
list — no per-tenant Auth config. And Firestore/Storage rules are origin-agnostic;
the tenant boundary is unchanged.

## Lifecycle

Removal on delete/downgrade/churn (delete the CF hostname, release the uniqueness
claim — otherwise we keep paying and, worse, keep serving), slug rename → PATCH
metadata, status drift → poll and tell the studio.

## Available today, no DNS

The embed widget system already exists (`embed_widgets/{teamId}`, framable from
anywhere, `/embed/{slug}/{sectionId}`). It covers discovery on a studio's existing
site, not transactions — clicking through opens the full page on linyup.com. It
stops being a stopgap the moment a domain lands, since the widget links then point
at the studio's own host.

## Open decisions

- ~~**Plan tier**~~ — settled: **coach+**, and now ADVERTISED, which is what
  settled it. It is stated once, as the `custom_domain` member of
  `PLAN_FEATURES`; the landing comparison row, the studio card's upgrade prompt
  and `assertPlanEligible` all read it from there rather than restating a plan
  list. Deliberately a tier below "Remove Linyup branding" (Studio+): a DOMAIN is
  the studio's own identity in the address bar and the From line, which is a
  different lever from taking our logo off the page.
- ~~**Zone**~~ — settled: `linyup.app`, see "Why Cloudflare" above and
  `infra/README.md` §5d.
- **Org tier** — a multi-club org wanting `zurich.federation.ch` per member studio
  is the same mechanism with a different authoring UI. Deferred, not designed out.
- **Path mounting** (`theirdojo.ch/shop` proxied from the studio's own site) needs
  a per-tenant base path in link generation — a second axis of complexity, and not
  reproducible by a customer on Wix or Squarespace. Rejected for v1.

Operator setup (zone, fallback origin, Worker, API token): `infra/README.md` §5d.
