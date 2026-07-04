import * as logger from 'firebase-functions/logger'
import type { CallableRequest } from 'firebase-functions/v2/https'

// App Check enforcement flag (deploy-time). Set APP_CHECK_ENFORCE=true in the
// functions environment to REJECT callables that arrive without a valid App Check
// token. Defaults to false = MONITOR mode.
//
// Why staged: the web App Check provider (reCAPTCHA) must be deployed and its key
// provisioned before enforcement, or every legitimate web client is locked out.
// It also must never be turned on for callables the mobile app reaches, since the
// Expo JS SDK cannot produce attestation tokens. Roll out as:
//   1. deploy provider + this in monitor mode → watch the [appcheck-monitor] logs
//   2. once tokens are consistently present, set APP_CHECK_ENFORCE=true
export const APP_CHECK_ENFORCE = process.env.APP_CHECK_ENFORCE === 'true'

// In monitor mode, log when a request lacks a verified App Check token so coverage
// can be confirmed before enforcement is switched on. `request.app` is populated
// whenever a valid token is presented, regardless of the enforce flag.
export function monitorAppCheck(request: CallableRequest<unknown>, fnName: string): void {
  if (!APP_CHECK_ENFORCE && !request.app) {
    logger.warn(`[appcheck-monitor] ${fnName}: request without a valid App Check token`)
  }
}
