# CLAUDE.md — dgstn-lineup (Lineup SaaS)

## What this project is

Lineup is a generalised SaaS version of **hmd-lineup** — a martial-arts school
management platform. The goal is to strip out sport-specific logic and offer the
same feature set (sessions, contacts, bookings, trial forms, team management,
student mobile app) to any type of coach, club, or multi-club organisation.

**Reference implementation**: the original project lives at
`C:\git\hmd\hmd-lineup` (or `~/git/hmd/hmd-lineup` on Mac/Linux). When porting
or extending any feature, always read the source there first.

---

## Monorepo layout

```
apps/web/          Next.js 15 App Router — admin dashboard (replaces CRA/Redux)
apps/mobile/       Expo 54 + React Native — student app (ported from hmd-lineup/student-app/)
packages/functions/ Firebase Cloud Functions v2 — TypeScript (replaces Babel JS)
packages/shared/   TypeScript types + Firestore path constants
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
| SMTP utils | `functions/src/utils/email.js` | Ported to `packages/functions/src/utils/email.ts` |
| Secrets | `functions/src/utils/secrets.js` | Ported to `packages/functions/src/utils/secrets.ts` |
| Teams utils | `functions/src/utils/teams.js` | Ported to `packages/functions/src/utils/teams.ts` |
| Recurrence | `functions/src/utils/recurrence.js` | Ported — DST-safe Europe/Zurich logic, keep as-is |
| Users utils | `functions/src/utils/users.js` | Ported to `packages/functions/src/utils/users.ts` (stub) |

---

## What's done (kickstart scaffold)

- Root workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- `packages/shared`: all types + Firestore path constants
- `packages/functions`: utils ported, ~12 functions fully implemented, rest stubbed
- Firebase config: `firestore.rules`, `firestore.index.json`, `storage.rules`, `database.rules.json`, `firebase.json`, `.firebaserc`
- `apps/web`: Next.js 15 scaffold with `(auth)` route group, `(portal)` route group, login page, AuthContext, TanStack Query
- `apps/mobile`: full port of `hmd-lineup/student-app/` with Lineup branding
- CI/CD: `.github/workflows/verify.yml` + `deploy.yml`

---

## What's NOT done yet (Phase 2+)

- **Stripe billing** — `SaasSubscription` type is stubbed, `saas_subscriptions` rules deny all
- **Self-service signup** — `app/signup/page.tsx` is a stub
- **Organisation tier** — multi-club hierarchy, `organizations/` collection stub only
- **SaaS operator console** — no admin panel for managing tenants
- **Full function port** — only ~12 of ~81 functions are implemented; the rest are stubbed with a `TODO: port from hmd-lineup/functions/src/{name}/index.js` comment
- **Trial booking page** — route exists at `(portal)/portal/[slug]/trial-booking/page.tsx` but needs full form logic (see `hmd-lineup/functions/src/booking/index.js` + `src/routes/TrialBooking/`)
- **shadcn/ui component library** — components are referenced but not yet generated; run `npx shadcn@latest add button card table form input select dialog sheet badge avatar dropdown-menu separator skeleton` in `apps/web/`
- **Gamification** — stubbed
- **Outreach/automation engine** — not started

---

## Architecture decisions (locked)

| Decision | Choice | Reason |
|---|---|---|
| UI library | shadcn/ui + Tailwind CSS | White-label flexibility; no vendor lock-in |
| State: server | TanStack Query v5 | Replaces react-redux-firebase |
| State: auth | AuthContext (React context) | Simpler than Redux for auth-only state |
| Firebase SDK | Modular v12 (no compat) | Tree-shakeable, future-proof |
| Functions | TypeScript, CommonJS target | No Babel, type-safe |
| Branding | "Lineup" (one word) | Clean, universal, connects to discipline of aligning |
| Multi-tenancy | `teamId` as tenant boundary | Matches existing Firestore rules pattern |
| Functions region | `europe-west6` | Same as hmd-lineup; change only if customer base shifts |

---

## Key patterns

### Always use `regionalFunctions`

```typescript
import { regionalFunctions } from '../utils/functions'

export const myFn = regionalFunctions.firestore
  .document('teams/{teamId}')
  .onCreate(async (snap, context) => { … })
```

### Public portal — ONLY read `public_profile` subcollections

Portal routes (`/portal/*`) must never query main collections. Always use:

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

### SaaS plan tiers (Phase 2)

```typescript
type SaasPlan = 'coach' | 'club' | 'org' | 'enterprise'
// stored in teams/{teamId}.plan + saas_subscriptions/{teamId}
```

---

## Firebase projects

| Alias | Project ID |
|---|---|
| staging | `lineup-staging` |
| production | `lineup-prod` |

Both need to be created in Firebase Console (not done yet — placeholders only).
Until then, use the hmd-lineup Firebase emulators for local development.

---

## Development commands

```bash
pnpm install                                    # root — installs all workspaces
pnpm --filter @lineup/web dev                   # Next.js dev server (port 3000)
pnpm --filter @lineup/functions run build       # compile functions TypeScript
pnpm --filter @lineup/functions run test        # run function tests (needs emulator)
pnpm --filter @lineup/mobile start              # Expo dev server
pnpm typecheck                                  # typecheck all packages
pnpm lint                                       # lint all packages
```

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