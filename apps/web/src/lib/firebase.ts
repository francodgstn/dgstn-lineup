import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
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

// Emulator ports, overridable for parallel worktree dev where a second suite
// runs on alternate ports (see firebase.worktree.json). Defaults match
// firebase.json.
export const EMULATOR_PORTS = {
  firestore: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? '8080',
  auth: process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? '9099',
  functions: Number(process.env.NEXT_PUBLIC_FUNCTIONS_EMULATOR_PORT ?? '5001'),
  storage: Number(process.env.NEXT_PUBLIC_STORAGE_EMULATOR_PORT ?? '9199'),
}

/**
 * WHERE the emulators are, from the point of view of whoever is asking.
 *
 * `localhost` is not a place — it is "wherever this code is running". That is
 * correct on the Next server (the emulators are on the same machine) and correct
 * in a browser on that machine, but wrong for every OTHER device: a phone on the
 * LAN opening `http://192.168.1.102:3000` resolves `localhost` to the PHONE, so
 * the page renders and every Firebase call fails with nothing in the UI to say
 * why.
 *
 * Following the page's own hostname makes one build serve both: open it at
 * `localhost` and the emulators are at `localhost`; open it at a LAN address and
 * they are at that address; a tunnel or a second machine works for free. It also
 * cannot drift out of step with the port env vars the way a hardcoded host does.
 *
 * The emulators already listen on 0.0.0.0 (see firebase.worktree.json), so
 * nothing on the server side needs to change for this to work.
 */
export function emulatorHost(): string {
  if (typeof window === 'undefined') return 'localhost'
  return window.location.hostname || 'localhost'
}

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

// Firestore instance. With emulators, initializeFirestore is needed for the
// custom host; it throws if the app already has one (HMR re-evaluates this
// module while the firebase/app registry persists) — fall back to the existing
// instance then.
//
// NEVER cache the instance on globalThis: the Next server evaluates this module
// once per bundle realm (server components vs route handlers vs generateMetadata),
// and an instance created in one realm fails another realm's instanceof checks
// inside collection()/query() with `invalid-argument` — which broke every
// server-side read (e.g. the public site's metadata resolved to "Site not found").
function createDb(): Firestore {
  if (!useEmulators) return getFirestore(app)
  try {
    if (emulatorProxy) {
      return initializeFirestore(app, {
        host: emulatorProxy.host,
        ssl: emulatorProxy.ssl,
        // Long-polling survives the dev-server proxy hop; WebChannel streaming
        // does not.
        experimentalForceLongPolling: true,
      })
    }
    return initializeFirestore(app, {
      host: `${emulatorHost()}:${EMULATOR_PORTS.firestore}`,
      ssl: false,
    })
  } catch {
    // Already initialized for this app in this realm (HMR re-run).
    return getFirestore(app)
  }
}

export const db = createDb()
export const storage = getStorage(app)
export const functions = getFunctions(app, 'europe-west6')

// Connect to local emulators when NEXT_PUBLIC_USE_EMULATORS=true.
// Guard with a globalThis flag to prevent double-connect on HMR (client)
// and across module re-evaluations in server components.
if (
  useEmulators &&
  !(globalThis as { _emulatorConnected?: boolean })._emulatorConnected
) {
  // The functions and storage emulators aren't reachable through the dev-server
  // proxy, so only wire them up for direct (non-proxied) local dev.
  if (!emulatorProxy) {
    const host = emulatorHost()
    connectFunctionsEmulator(functions, host, EMULATOR_PORTS.functions)
    connectStorageEmulator(storage, host, EMULATOR_PORTS.storage)
  }
  ;(globalThis as { _emulatorConnected?: boolean })._emulatorConnected = true
}

export default app
