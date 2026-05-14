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

// In a browser-based Codespace the emulators aren't on localhost — each
// forwarded port is served over HTTPS at <codespace>-<port>.<domain>.
// Server-side code runs inside the Codespace itself, so it still uses
// localhost; only the browser bundle needs the forwarded host.
const codespace = process.env.NEXT_PUBLIC_CODESPACE_NAME
const codespaceDomain = process.env.NEXT_PUBLIC_CODESPACE_DOMAIN

export function emulatorEndpoint(port: number): {
  host: string
  port: number
  ssl: boolean
} {
  if (typeof window !== 'undefined' && codespace && codespaceDomain) {
    return { host: `${codespace}-${port}.${codespaceDomain}`, port: 443, ssl: true }
  }
  return { host: 'localhost', port, ssl: false }
}

// Cache the Firestore instance across HMR / module re-evaluation —
// initializeFirestore throws if called twice for the same app.
const globalForFirebase = globalThis as { _lineupDb?: Firestore }

function createDb(): Firestore {
  if (!useEmulators) return getFirestore(app)
  const { host, port, ssl } = emulatorEndpoint(8080)
  return initializeFirestore(app, {
    host: `${host}:${port}`,
    ssl,
    // A proxied HTTPS emulator can't use WebChannel streaming.
    experimentalForceLongPolling: ssl,
  })
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
  const fns = emulatorEndpoint(5001)
  connectFunctionsEmulator(functions, fns.host, fns.port)
  ;(globalThis as { _emulatorConnected?: boolean })._emulatorConnected = true
}

export default app
