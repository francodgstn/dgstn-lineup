import * as logger from 'firebase-functions/logger'
import type { CallableRequest } from 'firebase-functions/v2/https'

// App Check enforcement flag for WEB-only callables (deploy-time). Set
// APP_CHECK_ENFORCE=true to REJECT callables that arrive without a valid App
// Check token. Defaults to false = MONITOR mode.
//
// Why staged: the web App Check provider (reCAPTCHA) must be deployed and its key
// provisioned before enforcement, or every legitimate web client is locked out.
// Roll out as:
//   1. deploy provider + this in monitor mode → watch the [appcheck-monitor] logs
//   2. once tokens are consistently present, set APP_CHECK_ENFORCE=true
export const APP_CHECK_ENFORCE = process.env.APP_CHECK_ENFORCE === 'true'

// THE SEPARATE flag for callables the MOBILE app can reach. The Expo JS SDK
// cannot produce App Check tokens, so enforcing on a callable the student app
// hits would lock its only login path out with no interpretable error — which is
// exactly what turning APP_CHECK_ENFORCE on used to do, because these two
// declared the SAME flag while a doc claimed they were excluded. They now declare
// this instead, so web enforcement is a safe flag-flip and mobile enforcement is
// a separate decision that waits until the app ships an attestation provider.
//
// WHICH callables are mobile-reachable is derived by GREPPING apps/mobile for
// httpsCallable, never from a hand-maintained list (the list is what rotted). As
// of 2026-08-26 that set is exactly { sendContactVerificationCode,
// loginContactWithCode } — see docs/app-check-rollout.md and the
// auth/appCheckMobile.test.ts pin, which re-derives it from source.
export const APP_CHECK_ENFORCE_MOBILE = process.env.APP_CHECK_ENFORCE_MOBILE === 'true'

// In monitor mode, log when a request lacks a verified App Check token so coverage
// can be confirmed before enforcement is switched on. `request.app` is populated
// whenever a valid token is presented, regardless of the enforce flag.
export function monitorAppCheck(request: CallableRequest<unknown>, fnName: string): void {
  if (!APP_CHECK_ENFORCE && !request.app) {
    logger.warn(`[appcheck-monitor] ${fnName}: request without a valid App Check token`)
  }
}
