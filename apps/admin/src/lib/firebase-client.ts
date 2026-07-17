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
  const authPort = process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? '9099'
  connectAuthEmulator(auth, `http://localhost:${authPort}`, { disableWarnings: true })
  ;(globalThis as { _adminAuthEmu?: boolean })._adminAuthEmu = true
}
