---
name: mobile-release
description: Release the Linyup member app (apps/mobile) — decide OTA vs store build, cut a mobile-v* tag, watch the EAS lanes, and finish a store submission. Use when asked to ship, hotfix, roll back or submit the mobile app, or to explain why a change needs a native build.
---

# Mobile release — the member app ships on its own tag

The app (`apps/mobile`, package `@linyup/mobile`, Expo slug `linyup`) releases
on **`mobile-v*` tags**, never on the backend's `v*` tags. The two cadences are
deliberately decoupled (`docs/mobile-roadmap-2026-09.md` §3): a web rollout is
instant and pinnable, a store build takes days and cannot be un-shipped.

## The three lanes (`.github/workflows/mobile.yml`)

| Trigger | What runs | You do |
|---|---|---|
| PR touching `apps/mobile/**` or `packages/shared/**` | lint, jest, `tsc`, `expo config` per project (catches config-time throws) | nothing |
| `main` merge touching the same | Expo's `continuous-deploy-fingerprint` action against the `preview` profile / `staging` branch: a build with the current fingerprint exists → OTA update; none → a preview build (internal distribution, staging Firebase). It comments the result on the commit. | install the preview build link on your phone |
| `mobile-v*` tag | same action, `store` profile / `production` branch, `auto-submit-builds` on: OTA when possible, otherwise a store build submitted to TestFlight and the Play internal track | promote in App Store Connect / Play Console once review passes |

## OTA or native build? The fingerprint decides — but know the rule

`runtimeVersion.policy: 'fingerprint'`: Expo hashes the native project (deps
with native code, config plugins, `app.config.js` native fields). A change
that alters the fingerprint **cannot** ship over the air; the lane builds
instead. JS/TS-only changes, assets, copy, most `packages/shared` changes → OTA.
Adding/removing a dependency with native code, touching `plugins`, permissions,
icons/splash, bundle ids → build.

`apps/mobile/fingerprint.config.js` makes the hash ignore `extra` and the
version fields (`SourceSkips.ExpoConfigExtraSection | ExpoConfigVersions`).
Without it the lane's runner — which evaluates `app.config.js` with no
`FIREBASE_API_KEY`, i.e. the demo project — would never hash the same as the
EAS build carrying the real key, every push would look native, and OTA would
never be chosen. Keep runtime data in `extra`; never move native config there.
`npx @expo/fingerprint apps/mobile` prints the hash and its sources.

Never bump `runtimeVersion` by hand; never set `updates.url` or
`extra.eas.projectId` by hand (owner-set once via `eas init`).

## Cutting a release

```bash
git checkout main && git pull
# version is ONE source: apps/mobile/package.json — app.config.js reads it
pnpm --filter @linyup/mobile version <major|minor|patch> --no-git-tag-version
git commit -am "chore(mobile): v1.2.0"
git tag -a mobile-v1.2.0 -m "<one line: what members get>"
git push origin main mobile-v1.2.0
```

The tag body is the release note (same convention as the backend's `v*`
tags). Store build numbers are EAS-managed (`appVersionSource: remote`,
`autoIncrement` on `store`).

## Backend compatibility — the rule the web never needed

A phone can be several store versions behind. Before merging a backend change:

- callable **responses are additive** — never remove or rename a field a
  shipped app reads (the `accessRule` removal crashed the appointment modal);
- the `listAvailability` and `getMyBookings` payloads have ONE typed owner in
  `packages/shared` — change the type, and every consumer's typecheck fails
  loudly;
- if a break is unavoidable, raise `app_settings/mobile.min_supported_version`
  (step 4 of the roadmap) so old builds are told to update instead of failing
  silently.

## Hotfix and rollback

- JS-only fix: merge to `main`, tag `mobile-vX.Y.Z` → OTA in minutes.
- Roll back an OTA: `eas update:republish --branch production --group <id>`
  (EAS keeps every update group; pick the previous one).
- Roll back a store build: you can't. Ship a fix forward; use the min-version
  gate to stop the broken build from running if it is data-damaging.

## Store submission checklist (first time and every native release)

- Build profiles are `development` (dev client, staging Firebase), `preview`
  (internal distribution, staging Firebase, `staging` channel) and `store`
  (store distribution, prod Firebase, `production` channel, auto-incremented
  build numbers). Only `store` is submittable; there is deliberately no
  internal "production" profile — it used to exist and produced builds that
  looked shippable and were not.
- Review login: operator console → Settings → Demo tenant → review access
  (fixed OTP for `app.review@example.com`, ≤ 60 days) — paste into ASC/Play
  "App access" notes (`docs/launch/prod-demo-and-store-review.md`).
- Account deletion is in-app (Profile → Delete my account) — Apple 5.1.1(v).
- Camera purpose string is explicit and the microphone permission is off
  (`expo-camera` plugin config in `app.config.js`).
- iPad screenshots are required while `ios.supportsTablet` is true.
- Privacy policy must cover the app's users (studio contacts); Terms/DPA must
  not carry the DRAFT banner.

## Secrets and where they live

- `EXPO_TOKEN` — GitHub repository secret (the CI's EAS identity).
- `EAS_PROJECT_ID` — set by `eas init` into `app.config.js` (`extra.eas.projectId`
  + `updates.url`); until then OTA is inert and the lanes' update step is a no-op.
- First Play submission is manual: Google requires the very first AAB to be
  uploaded by hand before `eas submit` can target a track.
- `FIREBASE_API_KEY` per environment — **EAS environment variables**, never
  `eas.json` `env` (which is a literal string, not interpolated).
- Apple ASC API key, Play service-account JSON — stored on EAS
  (`credentialsSource: remote`).

## Traps recorded

- `"${FIREBASE_API_KEY}"` in `eas.json` bakes the literal into the app: auth
  fails at runtime, build succeeds.
- A stale `packages/shared/dist` on the EAS builder: `eas-build-post-install`
  builds shared; if that script is removed, Metro fails to resolve
  `@linyup/shared`.
- `expo config` throws on an unknown `FIREBASE_PROJECT_ID` — every profile's
  env must name a project the `environments` map in `app.config.js` knows.
