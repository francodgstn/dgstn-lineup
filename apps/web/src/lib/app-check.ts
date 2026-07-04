import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import app from './firebase'

// Firebase App Check (reCAPTCHA v3) for the web client. Attests that requests to
// enforced Cloud Functions come from our real app, not a script.
//
// No-op unless we're in the browser, outside the emulator, and a site key is
// configured — so local dev, preview builds, and any deploy where the key isn't
// provisioned yet are unaffected (and never throw). Enforcement on the callables
// is a separate, deploy-time flag on the functions side (APP_CHECK_ENFORCE); wire
// this up and confirm tokens flow before turning enforcement on.
let initialized = false

export function initAppCheck(): void {
  if (initialized || typeof window === 'undefined') return
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') return

  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_RECAPTCHA_KEY
  if (!siteKey) return

  // Optional: register a debug token for testing against a real project locally.
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN
  if (debugToken) {
    ;(globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
  initialized = true
}
