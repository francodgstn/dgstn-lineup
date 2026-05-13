import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
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

export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, 'europe-west6')

// Connect to local emulators when NEXT_PUBLIC_USE_EMULATORS=true.
// Guard with globalThis flag to prevent double-connect on HMR (client) and
// across module re-evaluations in server components.
if (
  process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
  !(globalThis as { _emulatorConnected?: boolean })._emulatorConnected
) {
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectFunctionsEmulator(functions, 'localhost', 5001)
  ;(globalThis as { _emulatorConnected?: boolean })._emulatorConnected = true
}

export default app
