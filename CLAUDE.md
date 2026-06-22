# CLAUDE.md — dgstn-lineup (Linyup SaaS)

## What this project is

Linyup is a generalised SaaS version of **hmd-lineup** — a martial-arts school
management platform. The goal is to strip out sport-specific logic and offer the
same feature set (sessions, contacts, bookings, trial forms, team management,
student mobile app) to any type of coach, club, or multi-club organisation.

**Reference implementation**: the original project lives at
`C:\git\hmd\hmd-lineup` (or `~/git/hmd/hmd-lineup` on Mac/Linux). When porting
or extending any feature, always read the source there first.

---

## Monorepo layout

```
apps/web/           Next.js 15 App Router — admin dashboard (replaces CRA/Redux)
apps/mobile/        Expo 54 + React Native — student app (ported from hmd-lineup/student-app/)
packages/functions/ Firebase Cloud Functions v2 — TypeScript (replaces Babel JS)
packages/shared/    TypeScript types + Firestore path constants
```

Root tooling: **pnpm workspaces** + **Turborepo**. Node 22 required.

---

## Reference project structure (hmd-lineup)

| Concern | hmd-lineup path | Notes |
|---|---|---|
| Cloud Functions | `functions/src/{name}/index.js` | Babel ES6, `regionalFunctions` from `utils/functions.js` |
| Firestore rules | `firestore.rules` | 650 lines — ported verbatim into root `firestore.rules` here |
| Firestore indexes | `firestore.index.json` | Ported verbatim |
| Web app | `src/` | React 19, MUI 7, Redux — do NOT copy this; rewrite in Next.js |
| Student app | `student-app/` | Copied into `apps/mobile/` with branding updates |
| Data constants | `src/constants/firebasePaths.js` | Ported to `packages/shared/src/paths.ts` |
| Mail utils | `functions/src/utils/email.js` | Reworked: SMTP removed, now a thin façade over the Brevo mail service in `packages/functions/src/mail/` (see "Email sending" pattern) |
| Secrets | `functions/src/utils/secrets.js` | Ported to `packages/functions/src/utils/secrets.ts` |
| Teams utils | `functions/src/utils/teams.js` | Ported to `packages/functions/src/utils/teams.ts` |
| Recurrence | `functions/src/utils/recurrence.js` | Ported — DST-safe Europe/Zurich logic, keep as-is |
| Users utils | `functions/src/utils/users.js` | Ported to `packages/functions/src/utils/users.ts` (stub) |

---

## What's done (Phase 1 + Phase 2 start)

- Root workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- `packages/shared`: all types + Firestore path constants
- `packages/functions`: utils ported, ~12 functions fully implemented, rest stubbed
- Firebase config: `firestore.rules`, `firestore.index.json`, `storage.rules`, `database.rules.json`, `firebase.json`, `.firebaserc`
- `apps/web`: Next.js 15 scaffold with `(auth)` route group, `(public)` route group, login page, AuthContext, TanStack Query
- `apps/mobile`: full port of `hmd-lineup/student-app/` with Linyup branding
- CI/CD: `.github/workflows/verify.yml` + `deploy.yml`
- shadcn/ui component library installed in `apps/web/src/components/ui/`
- Build + typecheck clean across all packages; dev server runs at port 3000
- `firebase-auth.ts` split from `firebase.ts` to prevent SSG crash (auth/invalid-api-key)
- Bio-link routes tagged `force-dynamic`; `apps/web/.env.local` created with placeholders
- Self-service signup wizard (`app/signup/page.tsx`) — 2-step: account → team → dashboard
- Firebase emulator wired up for local dev (`demo-linyup` project, no real Firebase project needed)
- Public **Space** area (`/public/{slug}/space`) — contacts browse/consume published Online
  Courses on the web (interim surface until the mobile app ships). Free courses are anonymous;
  gated courses use the passwordless contact-session login. See "Public Space" under Key patterns.

---

## What's NOT done yet (Phase 2+)

### UI / UX gaps (priority)
- **Auth layout + nav** — no icons, no mobile drawer, no collapse mode (see UI/UX porting principles above)
- **Contact detail page** — `/contacts/[id]` route with tabbed view (profile, notes, activity, subscriptions)
- **Session calendar view** — calendar tab alongside list (react-big-calendar)
- **Mobile-first list layouts** — current list pages use desktop tables; need card/list patterns that work on mobile
- **Gamification** — stubbed page, no implementation

### Features not yet started
- **Stripe billing** — `SaasSubscription` type is stubbed, `saas_subscriptions` rules deny all
- **Organisation tier** — multi-team hierarchy, `organizations/` collection stub only
- **SaaS operator console** — no admin panel for managing tenants
- **Full function port** — only ~15 of ~81 functions are implemented; the rest are stubbed with a `TODO: port from hmd-lineup/functions/src/{name}/index.js` comment
- **Outreach/automation engine** — not started
- **Coaching page** — stub only; needs full implementation (see `docs/product-strategy.md` for scope). Coach plan: availability templates + bio-link-based slot booking + .ics emails. Studio plan: mobile app integration + push reminders. Source: `C:\git\hmd\hmd-lineup\functions\src\{bookCoachSlot,cancelCoachBooking,generateCoachSlots,trackCoachBookings}\` and `src\routes\CoachSlots\`

---

## Architecture decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| UI library | shadcn/ui + Tailwind CSS | White-label flexibility; no vendor lock-in |
| State: server | TanStack Query v5 | Replaces react-redux-firebase |
| State: auth | AuthContext (React context) | Simpler than Redux for auth-only state |
| Firebase SDK | Modular v12 (no compat) | Tree-shakeable, future-proof |
| Functions | TypeScript, CommonJS target, **firebase-functions v6 (gen2)** | No Babel, type-safe, already on latest |
| Branding | "Linyup" (coined word, linyup.com) | Energetic, invented, domain available |
| Multi-tenancy | `teamId` as tenant boundary | Matches existing Firestore rules pattern |
| Functions region | `europe-west6` | Same as hmd-lineup; change only if customer base shifts |

---

## Key patterns

### Cloud Functions — use v2 imports (NOT `regionalFunctions`)

The old project used `regionalFunctions` (firebase-functions v1 gen1). This project is on **v6 gen2**. When porting any function, update the import at the same time:

```typescript
// v2 gen2 — use this
import { onCall, onRequest } from 'firebase-functions/v2/https'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'

setGlobalOptions({ region: 'europe-west6' })

export const myFn = onCall(async (request) => { … })

// OLD v1 pattern from hmd-lineup — do NOT copy as-is
import { regionalFunctions } from '../utils/functions'
export const myFn = regionalFunctions.firestore.document('…').onCreate(…)
```

### Public tenant routes — ONLY read `public_profile` subcollections

Public tenant routes (`/public/{slug}/*`) must never query main collections. Always use:

```typescript
// resolve team by slug
const q = query(
  collectionGroup(db, 'public_profile'),
  where('slug', '==', slug),
  where('type', '==', 'team'),
  limit(1)
)
```

See `hmd-lineup/docs/portal-security.md` for full rules and patterns.

### Public tenant route structure

Routes are **tenant-first**: `/public/{slug}` is the team root and renders the team's chosen
default surface (`Team.default_public_surface`, defaults to `'bio-link'`). The root reads
`TeamPublicProfile.active_public_surfaces` (computed by `syncTeamPublicProfile` on team write)
to avoid redirecting to a dead surface. Sub-routes are siblings: `/public/{slug}/site`,
`/public/{slug}/space`, `/public/{slug}/booking`, `/public/{slug}/signup`,
`/public/{slug}/manage-booking`, `/public/{slug}/contact-update`, `/public/{slug}/coaching`.
Token-only routes stay standalone: `/public/event-invitation` and `/public/team-invitation/{token}`.

### Public Space — web access to Online Courses

`/public/{slug}/space` is a minimal, team-branded public area (sibling to `/public/{slug}`
bio-link root and `/public/{slug}/site`) where a team's **contacts** browse and consume
**published** courses without the mobile app. It resolves the team by slug with the same
`public_profile` collection-group query as the other public routes, and lists courses from
world-readable
`courses/{courseId}/public_profile/{courseId}` summaries written by `syncCoursePublicProfile`
(`packages/functions/src/sync/`). Never list the root `courses` collection publicly.

**Course access tiers** (`Course.accessRule.type` in `packages/shared/src/types/course.ts`):

| Tier | Stored value | Display | Who can read |
|---|---|---|---|
| Free | `free` | "Free" | Anyone, no login — incl. media |
| Sign-in required | `registered` | "Sign-in required" | Any signed-in contact of the team |
| Subscription | `subscription` | "Subscription" | Contact whose `subscription_type_id` ∈ `accessRule.subscriptionTypeIds` |
| Sold (one-off) | `purchase` | "Sold · {price}" | Contact who bought it (lifetime), OR whose `subscription_type_id` ∈ `accessRule.subscriptionTypeIds` (optional "included free") |

History: the middle tier was `members` until 2026-06; renamed (value + display) to
`registered` while pre-launch with seed data only. The stored enum value is the stable
machine identifier — post-launch, renames must be display-only.

**Selling courses (the `purchase` tier).** A purchase-tier course carries
`accessRule.priceAmount` (major units) and is sold one-off in `/public/{slug}/shop`
**next to products and subscriptions** (a "Courses" tab), while still consumed in
`/public/{slug}/space`. It reuses the products Stripe-Connect plumbing: the public
`createCourseCheckout` callable (`packages/functions/src/connect/payments.ts`) →
`createOneOffCheckoutSession` → the Connect webhook's `handleCourseCheckout`
(`webhook.ts`, `kind: 'course'`) links/creates the buyer's contact and writes a
**lifetime entitlement** at `courses/{courseId}/purchases/{contactId}`
(`COURSE_PURCHASES_SUBCOLLECTION`). Firestore rules unlock the course via
`hasPurchasedCourse(courseId)` inside `canReadPublishedCourse(courseId, c)`. The shop
+ Space read the per-course `public_profile` summary (now carries `priceAmount`) via
the same collection-group query; the Space also queries `purchases` (collection-group,
indexed on `contactId, teamId`) to show unlock state. The success page lands the buyer
in their Space (`seg=space`) to watch.

**Contact auth on the web** reuses the mobile contact-session mechanism: passwordless email
code (`sendMembershipVerificationCode`) → `loginContactWithCode` (matches the existing
contact, handles same-email selection, mints a session via `buildContactSession`) →
`signInWithCustomToken`. The custom-token claims `{ contactId, teamId, sessionExpires }`
are what Firestore + Storage rules check (`isContactOfTeam` / `canReadPublishedCourse` in
`firestore.rules`; `isContactSessionForTeam` / `isPublishedFreeCourse` in `storage.rules`).
Enforcement lives in the rules; the UI lock states are UX only.

### Firebase client SDK — server/client split

Next.js SSG/SSR crashes if `getAuth()` is called at module level on the server.

| File | Exports | Import from |
|---|---|---|
| `src/lib/firebase.ts` | `app`, `db`, `storage` | Anywhere (server + client safe) |
| `src/lib/firebase-auth.ts` | `auth` | Client components and `src/lib/auth.ts` only |

Never add `getAuth()` back to `firebase.ts`.

### Email sending — Brevo ESP (no SMTP)

All outbound mail goes through **Brevo's transactional HTTP API** via a
provider-agnostic service in `packages/functions/src/mail/`. There is **no SMTP /
nodemailer** and **no stored mail credentials** for anyone. Full docs:
`packages/functions/src/mail/README.md`.

- Call sites send via `sendEmail(...)` from `utils/email.ts` (a thin façade).
  **Pass `teamId` to send AS the studio**; omit it for Linyup **system mail**
  (from `hello@linyup.com`).
- **Sender resolution** (`mail/senderResolution.ts`, pure + unit-tested): a studio
  sends **Managed** (studio name over a `linyup.com` address, Reply-To = the
  studio's contact email) by default, or from a **BYO domain** once verified in
  Brevo (paid plans only — `coach`/`studio`/`organization`). BYO falls back to
  Managed automatically until verified.
- Per-studio config lives at `teams|organizations/{id}/integrations/email_sender`
  (`EmailSenderConfig`, no credentials). BYO domain-auth callables:
  `registerSenderDomain` / `checkSenderDomain` / `useManagedSender`.
- Brevo event webhook `handleBrevoWebhook` writes `mail_suppressions/*` on
  bounce/block/spam so dead addresses are skipped; `mail_sends/*` is the
  idempotency + delivery ledger. Secrets: `brevo-api-key`, `brevo-webhook-secret`
  (Secret Manager; emulator env `BREVO_API_KEY` / `BREVO_WEBHOOK_SECRET`).

### SaaS plan tiers (Phase 2)

```typescript
type SaasPlan = 'free' | 'coach' | 'studio' | 'organization'
// stored in teams/{teamId}.plan + saas_subscriptions/{teamId}
```

**Plan IDs vs display names:** plan IDs are stable machine identifiers
(Firestore data, security rules, Stripe lookup keys) and must not change once
real customer data exists. Marketing names live in the `Plans` namespace of
`apps/web/messages/*.json`, resolved via `usePlanName()`
(`apps/web/src/hooks/usePlanName.ts`) — never hardcode plan display names in
components or copy. History: the tier was `club` until 2026-06; it was fully
renamed (ID + display) to `studio` while the product was pre-launch with seed
data only. Post-launch, renames must be display-only.

---

## Firebase projects

| Alias | Project ID |
|---|---|
| default (local) | `demo-linyup` (emulator only — `demo-` prefix bypasses project validation) |
| staging | `linyup-staging` |
| production | `linyup-prod` |

Staging and production need to be created in Firebase Console (not done yet).
For local development use the Firebase emulators — no real project needed.

---

## Firebase emulators

Auth: `localhost:9099` | Firestore: `localhost:8080` | Storage: `localhost:9199` | UI: `localhost:4000`

`.env.local` sets `NEXT_PUBLIC_USE_EMULATORS=true`. Emulator connections are guarded by this flag + a `globalThis` flag to prevent HMR double-connect. Storage is wired up in `firebase.ts` (`connectStorageEmulator`, port 9199) — needed for file/image uploads (e.g. Online Courses media + attachments).

Start from repo root (Java required — use external terminal if VS Code's integrated terminal can't find Java). Include `storage` whenever you need uploads:

```
firebase emulators:start --only auth,firestore,storage
```

### Emulator data modes

Two isolated datasets, never mixed:

| Command | Dataset | Notes |
|---|---|---|
| `pnpm emulators:seed` | Fresh seed (wipes + re-seeds) | Three plan-tier demo accounts |
| `pnpm emulators:demo` | `snapshots/demo/` | Persistent demo data for live demo; auto-saved on exit |
| `pnpm emulators:hmd` | `snapshots/hmd-migration/` | Real HMD data after migration; auth+firestore only |

`snapshots/` is gitignored. Bootstrap each snapshot once — see `scripts/MIGRATE-HMD.md` for the HMD snapshot and the inline docs in `scripts/emulators-demo.mjs` for the demo snapshot.

---

## Firestore security rules

- **Team creation:** any authenticated user can create a team where `createdBy == request.auth.uid` — enables self-service signup.
- **Team member self-provision:** a user can write their own `team_members` doc as `owner` on signup (before membership exists).
- Everything else requires strict team-membership checks (`isTeamMember`, `hasTeamRole`).

---

## Internationalisation (i18n)

**Library:** `next-intl` — installed in `@linyup/web`.

**Locales:** `en` (default), `de`, `fr`, `it` — all four national languages of Switzerland.

**Locale in URL:** `localePrefix: 'as-needed'` — English keeps clean URLs (`/dashboard`); other locales get a prefix (`/de/dashboard`, `/fr/contacts`). Middleware rewrites English paths internally.

**File structure:**
```
apps/web/
├── messages/               ← one JSON per locale
│   ├── en.json             ← source of truth (always complete)
│   ├── de.json
│   ├── fr.json
│   └── it.json
└── src/
    ├── i18n/
    │   ├── routing.ts      ← defineRouting (locales, defaultLocale, localePrefix)
    │   ├── request.ts      ← getRequestConfig (loads messages per locale)
    │   └── navigation.ts   ← createNavigation (locale-aware Link, useRouter, usePathname)
    ├── middleware.ts        ← createMiddleware(routing)
    └── app/
        ├── layout.tsx      ← minimal root: just `return children`
        └── [locale]/
            ├── layout.tsx  ← html+body, NextIntlClientProvider, QueryProvider, AuthProvider
            └── (auth)/     ← all authenticated routes live here
```

**Rules:**
- All routes live under `app/[locale]/`. Never add routes directly to `app/` (except `layout.tsx`).
- Import `Link`, `useRouter`, `usePathname` from `@/i18n/navigation` — NOT from `next/link` or `next/navigation`. The i18n wrappers add locale context automatically.
- Use `useTranslations('Namespace')` for all visible strings. Never hardcode UI text.
- Message keys live in `en.json` first. Add the same key to `de.json`, `fr.json`, `it.json` immediately.
- Sport type names in the signup form are kept in English for now (they're international proper nouns); translate when the need arises.
- Date formatting uses the browser locale via `toLocaleDateString()`. "Today"/"Tomorrow" labels come from `Common.today` / `Common.tomorrow` in messages.
- `typedRoutes: true` is still enabled. With `[locale]` in the path, many route literals need `as Route` cast. This is expected — use casts rather than disabling typedRoutes.

## Next.js specifics

- `typedRoutes: true` at root level in `next.config.ts`. Use `Route` from `next` for typed hrefs.
- Bio-link routes must export `export const dynamic = 'force-dynamic'` to prevent SSG Firebase calls.
- `Input` component in `src/components/ui/input.tsx` uses a plain `<input>` (not `@base-ui/react`) — do not revert this; the base-ui wrapper causes SSR hydration mismatches.

---

## Development commands

**Local dev = one process per terminal.**

In VS Code (the usual way): **Ctrl+Shift+P → "Tasks: Run Task"** → pick a service or a
`Stack:` preset (`.vscode/tasks.json`). Each runs in its own dedicated integrated
terminal; the `Stack:` presets launch several at once (e.g. "Stack: Web" = emulators +
web). Add/extend presets there.

Or run the scripts directly (start the backend in one terminal, then each app in its own):

```bash
pnpm install            # root — installs all workspaces (once)

# ── Terminal 1: backend (pick ONE dataset — see "Emulator data modes") ──
pnpm emulators:seed     # fresh seed: emulators (auth+firestore+functions+storage) + 3 demo accounts
pnpm emulators:demo     # persistent demo snapshot
pnpm emulators:hmd      # HMD migration snapshot (auth+firestore+storage)

# ── Terminal 2+: apps (one per terminal, as needed) ──
pnpm dev:web            # Next.js admin dashboard (port 3000)
pnpm dev:admin          # operator console (port 3002)
pnpm dev:landing        # Astro marketing site (port 4321)
pnpm dev:mobile         # Expo student app

# ── Optional extra terminals ──
pnpm stripe:listen      # forward Stripe test webhooks to the local Functions emulator
pnpm functions:watch    # rebuild Cloud Functions on save (when editing functions)
```

Quality / CI checks (run anytime): `pnpm build` · `pnpm lint` · `pnpm typecheck` ·
`pnpm test` · `pnpm format`. Cloud/data ops live under `seed:*` / `reset:*` /
`migrate:hmd` / `stripe:sync` / `emulators:export:*` — not part of day-to-day startup.

---

## UI/UX porting principles

**Goal: functional parity, not pixel-perfect copy.**

hmd-lineup's UI patterns were designed carefully — especially for mobile. When building or refactoring any page, read the reference first and replicate the *functionality and layout intent*, even though the visual style will differ (shadcn/Tailwind vs MUI).

### What must be ported faithfully

- **Navigation**: icons on every nav item, collapsible sidebar on desktop (full ↔ icon-only), mobile hamburger + swipeable sheet drawer, user/team info at bottom
- **List pages**: mobile-first card/list layouts (avatar + name + status chips), NOT desktop-only tables. Tables are only acceptable for data-heavy views where mobile is less important.
- **Detail pages**: contacts, sessions, events, and bookings all have full detail pages (own route), not just edit modals. A modal is only acceptable for quick create/edit of simple entities.
- **Multi-tab detail views**: contact detail has tabs (profile, notes, activity, subscriptions, gamification). Port the tab structure even if some tabs start empty.
- **Calendar view for sessions**: sessions page has a list tab AND a calendar tab (month/week/day). Use `react-big-calendar` or equivalent.
- **Search + filters**: every list page with >1 filter has a search field + collapsible filter panel.
- **Confirmation dialogs**: all destructive actions (delete, archive) require a confirmation dialog.
- **FAB / primary action**: "New …" button is fixed bottom-right on mobile (FAB pattern), inline toolbar button on desktop.

### What to intentionally diverge from

- Visual style: MUI components → shadcn/ui + Tailwind equivalents
- Redux state → TanStack Query + React context
- Sport-specific fields: belt ranks, Swiss QR Bill, federation logic → remove or generalise
- HMD-specific copy and branding

### Rule

Before writing a new page or refactoring an existing one, check:
```
C:\git\hmd\hmd-lineup\src\routes\{Feature}\   ← reference UX and data flow
```
If a pattern exists in hmd-lineup and is not sport-specific, port it.

---

## Using the reference project in this session

When asked to implement a feature, check the reference first:

```
@C:\git\hmd\hmd-lineup\functions\src\{feature}\index.js   # source function to port
@C:\git\hmd\hmd-lineup\src\routes\{Feature}\              # web UI to re-implement
@C:\git\hmd\hmd-lineup\docs\{topic}.md                    # architecture docs
```

The hmd-lineup codebase is the source of truth for business logic. Port logic faithfully;
only diverge where the old code is HMD-specific (belt ranks, Swiss QR Bill, etc.).
