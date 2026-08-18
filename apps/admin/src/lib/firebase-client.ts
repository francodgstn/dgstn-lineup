'use client'

import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'

// Client Firebase — used ONLY by the login page to obtain an ID token via
// Google sign-in. All data access happens server-side via the Admin SDK.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)

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
  ;(globalThis as { _adminAuthEmu?: boolean })._adminAuthEmu = true
}
