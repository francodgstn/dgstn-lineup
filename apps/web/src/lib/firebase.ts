import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true'

// In a browser-based Codespace the emulators aren't reachable on localhost.
// Instead of relying on (public) forwarded emulator ports, the browser talks
// to this app's own origin and the Next.js dev server proxies the emulator
// API paths to the real emulators — see next.config.ts rewrites.
// Server-side code and normal local dev still hit the emulators directly.
export const emulatorProxy =
  typeof window !== 'undefined' && process.env.NEXT_PUBLIC_CODESPACE_NAME
    ? {
        origin: window.location.origin,
        host: window.location.host,
        ssl: window.location.protocol === 'https:',
      }
    : null

// Cache the Firestore instance across HMR / module re-evaluation —
// initializeFirestore throws if called twice for the same app.
const globalForFirebase = globalThis as { _lineupDb?: Firestore }

function createDb(): Firestore {
  if (!useEmulators) return getFirestore(app)
  if (emulatorProxy) {
    return initializeFirestore(app, {
      host: emulatorProxy.host,
      ssl: emulatorProxy.ssl,
      // Long-polling survives the dev-server proxy hop; WebChannel streaming
      // does not.
      experimentalForceLongPolling: true,
    })
  }
  return initializeFirestore(app, { host: 'localhost:8080', ssl: false })
}

export const db =
  globalForFirebase._lineupDb ?? (globalForFirebase._lineupDb = createDb())
export const storage = getStorage(app)
export const functions = getFunctions(app, 'europe-west6')

// Connect to local emulators when NEXT_PUBLIC_USE_EMULATORS=true.
// Guard with a globalThis flag to prevent double-connect on HMR (client)
// and across module re-evaluations in server components.
if (
  useEmulators &&
  !(globalThis as { _emulatorConnected?: boolean })._emulatorConnected
) {
  // The functions emulator isn't started by scripts/dev.sh; only wire it up
  // for direct (non-proxied) local dev.
  if (!emulatorProxy) connectFunctionsEmulator(functions, 'localhost', 5001)
  ;(globalThis as { _emulatorConnected?: boolean })._emulatorConnected = true
}

export default app
