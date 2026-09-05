import { initializeApp } from 'firebase/app';
import { Platform } from 'react-native';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getFunctions as getFirebaseFunctions,
  connectFunctionsEmulator,
} from 'firebase/functions';
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  connectAuthEmulator,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/**
 * Default region for Cloud Functions
 * All functions are deployed to this region
 */
const FUNCTIONS_REGION = 'europe-west6'; // Zurich, Switzerland

/**
 * Firebase configuration loaded from Expo Constants
 * Set via environment variables in eas.json build profiles (real builds), or
 * defaulted to the demo-linyup emulator project for local dev (app.config.js).
 */
const firebaseConfig = Constants.expoConfig?.extra?.firebase;
const useEmulators = Constants.expoConfig?.extra?.useEmulators === true;

/** Emulator ports for this checkout's port slot — resolved once, in
 *  app.config.js, from EXPO_PUBLIC_*_EMULATOR_PORT (scripts/local-env.mjs
 *  writes them to .env.local). The fallbacks are slot 0 / firebase.json. */
const emulatorPorts: { firestore: number; auth: number; functions: number } = {
  firestore: 8080,
  auth: 9099,
  functions: 5001,
  ...(Constants.expoConfig?.extra?.emulatorPorts ?? {}),
};

/** The environment's web app origin (Space / admin) — set per environment in
 *  app.config.js's `environments` map. Used to point a member at
 *  `{webAppUrl}/public/{slug}/space` when their studio's plan does not
 *  include the mobile app. */
export const webAppUrl: string = Constants.expoConfig?.extra?.webAppUrl ?? 'https://app.linyup.com';

if (!firebaseConfig) {
  throw new Error(
    'Firebase configuration not found. Ensure FIREBASE_* environment variables are set in eas.json or .env file.'
  );
}

/**
 * Host the emulators are reachable on. On web that's localhost; on a device or
 * simulator the JS bundle runs off-device, so we reach the dev machine through
 * the Metro/Expo host IP.
 */
function resolveEmulatorHost() {
  if (Platform.OS === 'web') return 'localhost';
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ||
    '';
  const host = hostUri.split(':')[0];
  return host || 'localhost';
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Auth with native persistence when available
export const auth =
  Platform.OS === 'web'
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });

// Single Functions instance (region-scoped). Memoized so the emulator is only
// connected once.
const functionsInstance = getFirebaseFunctions(app, FUNCTIONS_REGION);

if (useEmulators) {
  const host = resolveEmulatorHost();
  connectFirestoreEmulator(db, host, emulatorPorts.firestore);
  connectAuthEmulator(auth, `http://${host}:${emulatorPorts.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functionsInstance, host, emulatorPorts.functions);
  console.log(
    `[firebase] Using emulators at ${host} (firestore:${emulatorPorts.firestore}, auth:${emulatorPorts.auth}, functions:${emulatorPorts.functions})`
  );
}

/**
 * Get Firebase Functions instance configured for the correct region
 * @returns Functions instance for europe-west6
 */
export function getFunctions() {
  return functionsInstance;
}

export default app;
