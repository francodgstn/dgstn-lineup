# Lead demo tenants

A **lead** is a prospective customer we demo Linyup to. Each lead gets a dedicated
sandbox tenant that mirrors their **real public data** (schedule, offerings, pricing,
site copy, images — used with their permission) plus fully **synthetic contacts**
(invented names — never real client data).

## Seeding

```bash
# Cloud linyup-sandbox (via local ADC — gcloud auth application-default login):
pnpm lead:seed --lead swimli            # idempotent — re-runs overwrite in place
pnpm lead:seed --lead swimli --reset    # tear the lead's tenant down first

# Local emulator rehearsal — start the emulators first (incl. Storage, or image
# uploads are skipped), then --target emulator sets the host env vars for you:
pnpm lead:seed --lead swimli --target emulator

# ...equivalent to setting the hosts by hand (an already-set host wins):
FIRESTORE_EMULATOR_HOST=localhost:8080 \
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199 \
pnpm lead:seed --lead swimli
```

Never use `pnpm sandbox:reset` to clean up a lead — it wipes the six `/try`
playground teams too; `--reset` is lead-scoped.

Lead tenants are intentionally **not** listed on the public `/try` picker
(`apps/web/src/lib/demo.ts`) — access is via their direct logins (printed by the
seed) and `/public/{slug}` URLs.

For a persistent local snapshot: seed into running emulators, then
`pnpm emulators:export:swimli`; from then on `pnpm emulators:swimli` restores it
(including uploaded images — note the snapshot bakes `localhost:9199` URLs, so it
is for local rehearsal only).

## Adding a new lead

> **Lead folders are local-only.** Every `scripts/leads/{lead}/` folder (profile +
> assets) is gitignored via `scripts/leads/.gitignore`, so prospective-customer data
> never lands in the repo — only `README.md` and `types.ts` are tracked. Keep your
> lead folders on your machine (and back them up outside the repo). Seeding is
> **local-only** — run it from your machine with the profile + images present.

1. Create `scripts/leads/{lead}/profile.ts` exporting a `LeadProfile`
   (contract: `scripts/leads/types.ts`; the local `swimli` folder is the reference).
2. Optionally add images under `scripts/leads/{lead}/assets/` (see below).

Profile ground rules:

- **Public data only** for the business side (schedule, pricing, copy, images),
  gathered with the lead's permission. Mark any invented/assumed values (e.g.
  unconfirmed prices) via `priceAssumed` + a `notes` entry so the demo never
  overstates what's real.
- **Contacts are always synthetic.** Realistic names and distributions, yes —
  real people, never.
- The tenant id is `lead-{id}`; staff logins use `{name}@{id}.linyup.com`-style
  addresses with the shared demo password.

## Assets folder (`scripts/leads/{lead}/assets/`)

Drop-in images the seed uploads to Storage (tokened download URLs — no rules
changes needed; the admin UI can replace any of them later). Accepted formats:
`.jpg` `.jpeg` `.png` `.webp`. Missing files fall back to accent-color branding
with a console warning.

| Base name                                              | Wired to                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `profile`                                              | team profile image (bio-link avatar)                                                |
| `hero`                                                 | team hero image (bio-link header)                                                   |
| `activity-<slug>`                                      | activity card cover (per `LeadActivityDef.imageAsset`)                              |
| `course-cover`                                         | online-course cover (per `LeadCourseDef.coverAsset`)                                |
| section `imageAsset` / `bgImageAsset` / `imagesAssets` | website section images (e.g. `site-hero`, `site-about`, `coach-ash`, `gallery-1…n`) |

Only images you have permission to use go here. Like the rest of the lead folder,
`assets/` is gitignored — images stay on your machine and are never committed
(licensing + repo size). Missing files fall back to accent-color branding.
