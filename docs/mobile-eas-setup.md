# Member app — EAS + CI setup for STAGING (a runbook for a local agent)

This is the one-time, owner-account work that `.github/workflows/mobile.yml`
needs before its lanes do anything: an EAS project, the staging Firebase
config, the CI token. It is written to be executed by a Claude Code session
**on the owner's laptop**, where the Expo account, the GitHub CLI and a
browser are at hand — none of that exists in a cloud session. Scope is
**staging only**: nothing here touches `linyup-prod`, the stores, or
`eas submit`.

Paste this into a local session to run it:

> Read `docs/mobile-eas-setup.md` and execute it for staging, step by step.
> Stop and ask me whenever a step needs something only I can do (a browser
> login, a token to paste, an Apple/Google account). Never run `eas submit`,
> never touch `linyup-prod`, and open a PR for the repo changes instead of
> pushing to `main`.

## What is already true (do not redo)

- `apps/mobile/eas.json` defines the profiles `development` (dev client,
  channel `development`, EAS environment `development`), `preview` (internal
  APK / iOS internal, channel `staging`, EAS environment `preview`) and `store`
  (channel `production`, EAS environment `production`). Both non-prod profiles
  pin `FIREBASE_PROJECT_ID=linyup-staging` in `env` — that value is a plain
  literal, which is fine for a project id and is exactly why the **API key must
  NOT go there** (`eas.json` does not interpolate `${…}`; a `"${FIREBASE_API_KEY}"`
  string would be baked into the app as-is).
- `apps/mobile/app.config.js` reads `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`
  and `EAS_PROJECT_ID` from the environment and **refuses a real project
  without a key** at config time (a clear error, not a runtime
  `auth/invalid-api-key`). `updates.url` is set only when the EAS project id is
  known; until then OTA is inert by design.
- `apps/mobile/fingerprint.config.js` keeps `extra` and version fields out of
  the native fingerprint, so the CI runner and the EAS build hash the same
  project.
- `.github/workflows/mobile.yml`: PR → checks; push to `main` → the `staging`
  lane (`expo/expo-github-action/continuous-deploy-fingerprint`, profile
  `preview`, branch `staging`); tag `mobile-v*` → the `release` lane. Both lanes
  need `secrets.EXPO_TOKEN`; the release lane additionally needs the
  `production` GitHub environment, which exists.
- The staging Firebase **web** config is public by design (it ships in every
  browser bundle) and is already committed in `apps/web/apphosting.yaml`:

  | Field | Value |
  |---|---|
  | `apiKey` | `AIzaSyAuMHWbGKmyL78xVfrStkIctShzqrd4zcg` |
  | `messagingSenderId` | `157648925506` |
  | `appId` (web) | `1:157648925506:web:5e3aa70930d777f8374edb` |
  | `projectId` | `linyup-staging` |

  The Firebase JS SDK the app uses works with the web app's key. A dedicated
  iOS/Android Firebase app registration is only needed for App Check on
  mobile and native push — not for this runbook. Terraform prints the same
  values with `terraform output -json firebase_web_config` in
  `infra/environments/staging`.
- The member app's test login on staging is the review studio:
  `app.review@example.com`, code `123456` (`docs/test-accounts.md`). It exists
  once `pnpm staging:seed` has run after this branch of work merged; the fixed
  code's window is 60 days from that seed.

## Steps

Work from the repo root on a fresh branch (`git checkout -b chore/mobile-eas-staging`).

### 1. Preflight

```bash
pnpm install && pnpm bootstrap
node --version                      # 22.x
npx eas-cli@latest --version        # installs on first use; no repo dependency
npx eas-cli whoami || npx eas-cli login
gh auth status                      # the GitHub CLI, for the repository secret
```

`eas login` opens a browser or asks for credentials — that is the owner's.
Everything below assumes `whoami` prints the account that should own the
project (the one the Apple/Google accounts will later be attached to).

### 2. Create/link the EAS project — `eas init`

```bash
cd apps/mobile
npx eas-cli init          # or: npx eas-cli project:init
# non-interactive: it refuses to CREATE without --force, which is the
# difference between linking an existing project and making a new one
```

Because `app.config.js` is dynamic, `eas init` **cannot write the id into the
config**. It prints the project id (a UUID) and, if the account is an
organisation, may ask for `owner`. Then, in `app.config.js`:

- make the id the default: `const easProjectId = process.env.EAS_PROJECT_ID || '<the uuid>'`
  (keep the env override — CI and a second account can still redirect it).
  **`||`, not `??`**: `.env.example` and every `.env.*` copied from it ship an
  empty `EAS_PROJECT_ID=`, and an empty string is not nullish — with `??` the
  staging target silently loses `updates.url` and OTA goes inert again;
- if `eas init` asked for an owner, add `owner: '<account slug>'` next to `slug`.

Verify: `FIREBASE_PROJECT_ID=demo-linyup npx expo config --type public --json | jq '.extra.eas, .updates'`
shows the id and an `updates.url` of `https://u.expo.dev/<uuid>`.

### 3. Fill the staging Firebase fields in `app.config.js`

In the `environments['linyup-staging']` entry replace the `messagingSenderId`
TODO with `'157648925506'`. Leave `linyup-prod` and `linyup-sandbox` as they
are (out of scope). `appId` is not read by the config today; do not add it
unless you also add it to the `firebaseConfig` object it feeds.

### 4. The local dev target

`pnpm bootstrap` already wrote `apps/mobile/.env.staging` from the template.
Set `FIREBASE_API_KEY=AIzaSyAuMHWbGKmyL78xVfrStkIctShzqrd4zcg` in it (the
file is gitignored). Verify the config evaluates and the app starts:

```bash
pnpm --filter @linyup/mobile exec dotenv -e .env.staging -- npx expo config --type public --json | jq '.extra.firebase.projectId, .extra.useEmulators'
# → "linyup-staging", false
pnpm dev:mobile            # Metro; open in Expo Go or a dev client, sign in with the review login
```

### 5. EAS environment variables — the API key for builds

The key must reach EAS builds through **EAS environment variables**, one per
environment the profiles name. It is public config, so `plaintext` visibility
is correct (a `secret` would hide it from `expo config` on the builder, which
needs to read it):

```bash
cd apps/mobile
for env in development preview; do
  npx eas-cli env:create --environment "$env" --name FIREBASE_API_KEY \
    --value AIzaSyAuMHWbGKmyL78xVfrStkIctShzqrd4zcg --visibility plaintext --non-interactive
done
npx eas-cli env:list --environment preview       # FIREBASE_API_KEY present
```

Do **not** create the `production` one here — that is the prod key and a
separate, deliberate step.

### 6. The CI token — `EXPO_TOKEN`

Tokens are minted in the browser, never by the CLI: Expo →
`https://expo.dev/accounts/<account>/settings/access-tokens` → **Create
token** (name it `github-actions dgstn-linyup`). Ask the owner to paste it,
then:

```bash
gh secret set EXPO_TOKEN --repo francodgstn/dgstn-linyup     # reads the value from the prompt
```

Never write the token into any file in the repo, `.env.*` included.

### 7. Build credentials for staging (Android first)

The `preview` profile builds an **APK** for Android and an **internal**
distribution build for iOS. Android needs a keystore, which EAS generates and
stores (`credentialsSource: remote`) on the first build; iOS internal
distribution needs an Apple Developer login plus registered device UDIDs
(`eas device:create`) — do Android first, iOS when the owner is at the keyboard.

```bash
cd apps/mobile
npx eas-cli build --profile preview --platform android    # accept "generate a new keystore"
```

Install the resulting APK (the build page shows a QR code / link) and sign in
with the review login. What to check on the device: the sign-in lands on the
profile; the studio look applies (the review studio has no preset, so it stays
Linyup purple — a studio with `ink` + a warm accent is the visual test);
`Settings → Member app` in the operator console with a minimum version above
`1.0.0` shows the update-required screen on the next foreground.

### 8. Prove the lane

Commit the `app.config.js` changes (project id, owner if any, sender id) on
the branch, open a PR, let the `Mobile` check job pass, merge. The push to
`main` runs the `staging` lane: with the token and the project in place the
`continuous-deploy-fingerprint` step either publishes an OTA update to the
`staging` branch or starts a `preview` build, and comments the result on the
commit. Two inputs the workflow header asks to verify on this first run: the
action's `auto-submit-builds` input name (release lane only) and that the
`preview` EAS environment carries `FIREBASE_API_KEY` (step 5).

If the lane fails on `eas update`/`eas build` with an auth error, the token is
wrong or scoped to another account; if it fails computing the fingerprint,
run `npx @expo/fingerprint apps/mobile` locally and compare.

### 9. Record what changed

Add the project id and the account slug to `docs/mobile-roadmap-2026-09.md` §7
(strike the items done), and tick the same in
`.claude/skills/mobile-release/SKILL.md` → "Secrets and where they live".

## Out of scope here, on purpose

Production key and `production` EAS environment; App Store Connect record,
`ascAppId`, ASC API key; Play service account and the first manual AAB upload;
store metadata (screenshots, privacy policy covering app users, support URL,
the review code in ASC/Play). Those are the remaining §7 items and each one
starts with a login only the owner has.
