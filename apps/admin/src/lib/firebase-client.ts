'use client'

import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

// Client Firebase — the login page (obtaining an ID token) and operator ACTIONS
// that run as callables in the backend.
//
// All DATA ACCESS still happens server-side via the Admin SDK; that rule has not
// moved. What widened is actions: a callable is how this product performs an
// authenticated operation in the backend, and the operator-only ones
// (`manageDemoTenant`, `setReviewAccess`) run for minutes and write across a
// whole tenant — work that belongs in a Cloud Function with its own timeout,
// not in a Next request. The callables re-check the operator themselves
// (`utils/operator.ts`), so nothing is trusted from the browser.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
// Same region as every other function in this project.
export const functions = getFunctions(app, 'europe-west6')

if (
  process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
  typeof window !== 'undefined' &&
  !(globalThis as { _adminAuthEmu?: boolean })._adminAuthEmu
) {
  // Port overridable for parallel worktree dev (firebase.worktree.json).
  // HOST follows the page, for the same reason apps/web does it (see
  // emulatorHost there): `localhost` means "this device", so a hardcoded one
  // sends a phone or a second machine to its own loopback and every auth call
  // fails silently. Opened at localhost this is byte-identical to before.
  const authPort = process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? '9099'
  const authHost = window.location.hostname || 'localhost'
  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true })
  const fnPort = Number(process.env.NEXT_PUBLIC_FUNCTIONS_EMULATOR_PORT ?? '5001')
  connectFunctionsEmulator(functions, authHost, fnPort)
  ;(globalThis as { _adminAuthEmu?: boolean })._adminAuthEmu = true
}
