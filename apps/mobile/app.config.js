/**
 * Expo dynamic configuration — Linyup mobile app
 *
 * Firebase environment is determined by FIREBASE_PROJECT_ID.
 * Only FIREBASE_API_KEY needs to be provided via environment.
 *
 * Usage:
 *   pnpm start                -> loads .env.staging    (linyup-staging — the default target)
 *   pnpm run start:prod       -> loads .env.production (linyup-prod)
 *   pnpm run start:emulators  -> demo-linyup + the local emulators; the emulator PORTS
 *                                come from .env.local (EXPO_PUBLIC_*_EMULATOR_PORT, written
 *                                by scripts/local-env.mjs for this checkout's port slot)
 *
 * Expo loads .env / .env.local itself before this file runs; the dotenv-cli
 * prefix in package.json only adds the per-target file on top.
 */
const { version } = require('./package.json')

// Terraform provisions the `<project>.firebasestorage.app` bucket naming
// scheme for every real project; the emulator project keeps the legacy
// `.appspot.com` form (the emulator never validates it against a real bucket).
const environments = {
  'demo-linyup': {
    authDomain: 'demo-linyup.firebaseapp.com',
    databaseURL: 'https://demo-linyup.firebaseio.com',
    projectId: 'demo-linyup',
    storageBucket: 'demo-linyup.appspot.com',
    messagingSenderId: 'demo',
    webAppUrl: 'http://localhost:3000',
  },
  'linyup-staging': {
    authDomain: 'linyup-staging.firebaseapp.com',
    databaseURL: 'https://linyup-staging.firebaseio.com',
    projectId: 'linyup-staging',
    storageBucket: 'linyup-staging.firebasestorage.app',
    messagingSenderId: '', // TODO: set from Firebase console
    webAppUrl: 'https://app-stg.linyup.com',
  },
  'linyup-sandbox': {
    authDomain: 'linyup-sandbox.firebaseapp.com',
    databaseURL: 'https://linyup-sandbox.firebaseio.com',
    projectId: 'linyup-sandbox',
    storageBucket: 'linyup-sandbox.firebasestorage.app',
    messagingSenderId: '', // TODO: set from Firebase console
    webAppUrl: 'https://demo.linyup.com',
  },
  'linyup-prod': {
    authDomain: 'linyup-prod.firebaseapp.com',
    databaseURL: 'https://linyup-prod.firebaseio.com',
    projectId: 'linyup-prod',
    storageBucket: 'linyup-prod.firebasestorage.app',
    messagingSenderId: '', // TODO: set from Firebase console
    webAppUrl: 'https://app.linyup.com',
  },
}

export default ({ config }) => {
  // Default to the local emulator project (demo-linyup) when no real API key is
  // provided — lets `pnpm start` run against the Firebase emulators with no real
  // Firebase project. EAS staging/prod builds set FIREBASE_API_KEY + FIREBASE_PROJECT_ID.
  const hasRealKey = !!process.env.FIREBASE_API_KEY
  const projectId = process.env.FIREBASE_PROJECT_ID || (hasRealKey ? 'linyup-staging' : 'demo-linyup')
  const envConfig = environments[projectId]

  if (!envConfig) {
    throw new Error(`Unknown FIREBASE_PROJECT_ID: ${projectId}`)
  }

  const useEmulators =
    projectId === 'demo-linyup' || process.env.EXPO_PUBLIC_USE_EMULATORS === 'true'

  // A real project with no key would run against it with the placeholder below
  // and fail later, as auth/invalid-api-key, with nothing to say which env file
  // was wrong. Refuse here, where the fix can be named. (CI's config check and
  // the EAS environments both set a key; the emulator needs none.)
  if (!hasRealKey && !useEmulators) {
    throw new Error(
      `FIREBASE_API_KEY is empty for ${projectId}. Set it in apps/mobile/.env.${
        projectId === 'linyup-prod' ? 'production' : 'staging'
      } (template: apps/mobile/.env.example; EAS builds: the environment's variables), ` +
        'or run `pnpm dev:mobile:emulators` for the local stack.'
    )
  }

  // Where the emulators listen, from the app's point of view. Slot 0 is the
  // documented default; a worktree on slot N gets N×10000 added (local-env).
  const emulatorPort = (name, fallback) => {
    const raw = process.env[`EXPO_PUBLIC_${name}_EMULATOR_PORT`]
    const n = Number(raw)
    return raw && Number.isInteger(n) && n > 0 ? n : fallback
  }
  const emulatorPorts = {
    firestore: emulatorPort('FIRESTORE', 8080),
    auth: emulatorPort('AUTH', 9099),
    functions: emulatorPort('FUNCTIONS', 5001),
  }

  const { webAppUrl, ...envFirebaseConfig } = envConfig

  const firebaseConfig = {
    ...envFirebaseConfig,
    // The Auth/Firestore emulators don't validate the key; a non-empty placeholder
    // avoids the SDK throwing auth/invalid-api-key in local dev.
    apiKey: process.env.FIREBASE_API_KEY || 'demo-api-key',
  }

  // The owner runs `eas init` later, which writes this into `extra.eas.projectId`.
  // Until then, `updates.url` stays undefined (OTA is inert, same as today) rather
  // than pointing at a project id that does not exist.
  const easProjectId = process.env.EAS_PROJECT_ID ?? ''

  return {
    ...config,
    name: 'Linyup',
    slug: 'linyup',
    version,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    scheme: 'linyup',
    runtimeVersion: {
      policy: 'fingerprint',
    },
    updates: easProjectId
      ? {
          url: `https://u.expo.dev/${easProjectId}`,
        }
      : undefined,
    plugins: [
      'expo-updates',
      '@react-native-community/datetimepicker',
      [
        'expo-camera',
        {
          cameraPermission: "Linyup uses the camera only to scan your studio's check-in QR code.",
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
    ],
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.dgstn.linyup',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        // Foreground is a white swoosh on transparency — bg must be brand purple
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#6d28d9',
      },
      package: 'com.dgstn.linyup',
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      softwareKeyboardLayoutMode: 'resize',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      firebase: firebaseConfig,
      useEmulators,
      emulatorPorts,
      webAppUrl,
      eas: {
        projectId: easProjectId,
      },
    },
  }
}
