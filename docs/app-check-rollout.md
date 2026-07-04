# App Check rollout runbook

Firebase App Check is **implemented but not turned on**. This is the one-time procedure to
enable it, done when you're ready — it is intentionally a manual, staged flip because turning
enforcement on before the client can produce tokens locks out real users.

See finding #3 in [`security-audit-2026-07.md`](./security-audit-2026-07.md) for the why.

## Current state (as shipped)

App Check is inert today — nothing is rejected:

- **Web** — `initAppCheck()` (`apps/web/src/lib/app-check.ts`, mounted via `AppCheckProvider`
  in the locale layout) **no-ops** unless `NEXT_PUBLIC_FIREBASE_APPCHECK_RECAPTCHA_KEY` is set,
  and it is always skipped under the emulator. With no key, the browser sends no token.
- **Functions** — `APP_CHECK_ENFORCE=false` in every `packages/functions/.env.*`, so
  `monitorAppCheck()` (`packages/functions/src/utils/appCheck.ts`) only **logs**
  `[appcheck-monitor] <fn>: request without a valid App Check token`. Nothing is blocked.

## Scope (what enforcement covers)

Enforced, once on — the **web-only** public callables:

- `createDropInCheckout` (`booking/dropIn.ts`)
- `createMembershipCheckout`, `createProductCheckout`, `createCourseCheckout` (`connect/payments.ts`)
- `submitForm` (`forms/submitForm.ts`)

**Explicitly excluded: `sendContactVerificationCode`.** The Expo mobile app calls it and, on
the Firebase JS SDK under Expo, cannot produce App Check attestation tokens — enforcing it
would break student-app login. Mobile enforcement is a separate future phase (see Caveats).

## Staged rollout — do these in order

> ⚠️ Never do step 4 before step 2 is live and confirmed (step 3). Enforcing while the web
> client is not yet sending tokens rejects every legitimate web request.

1. **Register App Check in the Firebase Console.** App Check → your **Web app** → register
   with **reCAPTCHA v3** (or reCAPTCHA Enterprise). This produces a reCAPTCHA v3 **site key**
   (public — safe to embed) linked to the project. Do this for the **staging** project first.

2. **Give the web client the key (staging).** Set
   `NEXT_PUBLIC_FIREBASE_APPCHECK_RECAPTCHA_KEY=<site key>` in the staging web app's
   environment and redeploy web. The browser now attaches App Check tokens to callable
   requests. (`APP_CHECK_ENFORCE` is still `false`, so this changes nothing user-facing yet.)

3. **Watch the monitor logs.** In Cloud Functions logs, filter for `[appcheck-monitor]`. On
   real staging traffic through the five callables above, these warnings should drop to ~zero
   as clients start sending valid tokens. If they persist, the web key/registration is wrong —
   fix before proceeding.

4. **Flip enforcement (staging → prod).** Set `APP_CHECK_ENFORCE=true` in
   `packages/functions/.env.staging`, redeploy functions, and smoke-test a drop-in checkout +
   a form submission. When staging is clean, repeat steps 1–2 for the **production** project
   (register App Check, set the prod web key) and set `APP_CHECK_ENFORCE=true` in
   `.env.production`.

To roll back at any point: set `APP_CHECK_ENFORCE=false` and redeploy functions (back to
monitor mode instantly). The web key can stay set — it's harmless without enforcement.

## Caveats

- **reCAPTCHA v3 false positives.** It scores requests; a small fraction of real users can be
  rejected. Watch error rates after step 4; keep the rollback (above) handy.
- **Mobile is not covered.** Enforcing App Check for the mobile-reachable callables needs
  native attestation — `@react-native-firebase/app-check` (Play Integrity / App Attest) plus
  an EAS **dev build** (not Expo Go). That's a separate project; until then keep
  `sendContactVerificationCode` and the other mobile callables unenforced.
- **Local testing.** To exercise App Check locally against a real project, set the optional
  `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN` (register the printed debug token in the Firebase
  console). Never set it in production.
