import 'server-only'
import {
  applicationDefault,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

// The Admin SDK talks to the emulators automatically when these env vars are
// set (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST). In that mode no
// real credentials are needed — only a projectId. In production (App Hosting /
// Cloud Run) we use Application Default Credentials from the runtime service
// account, which must be granted Firestore read access.
const useEmulators =
  process.env.USE_FIREBASE_EMULATORS === 'true' ||
  !!process.env.FIRESTORE_EMULATOR_HOST

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  'demo-linyup'

function createApp(): App {
  const existing = getApps()
  if (existing.length) return existing[0]!
  if (useEmulators) {
    // No credential against the emulator — would otherwise try to load ADC.
    return initializeApp({ projectId })
  }
  return initializeApp({ credential: applicationDefault(), projectId })
}

// Cache across HMR / module re-evaluation.
const globalForAdmin = globalThis as {
  _adminApp?: App
}
const app = globalForAdmin._adminApp ?? (globalForAdmin._adminApp = createApp())

export const adminDb = getFirestore(app)
export const adminAuth = getAuth(app)

// Which Firebase backend this console is operating on — surfaced in the shell
// (sidebar + mobile header) so an operator always knows what they're touching.
// Derives from the SAME resolution as the app initialization above, so the
// label can never drift from reality.
export interface FirebaseTarget {
  /** e.g. 'demo-linyup · emulator', 'linyup-sandbox', 'linyup-prod' */
  label: string
  /** True on the production project — the shell renders the label as a warning. */
  isProd: boolean
}

export function describeFirebaseTarget(): FirebaseTarget {
  return {
    label: useEmulators ? `${projectId} · emulator` : projectId,
    isProd: !useEmulators && projectId === 'linyup-prod',
  }
}
