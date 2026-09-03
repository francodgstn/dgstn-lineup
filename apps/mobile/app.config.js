/**
 * Expo dynamic configuration — Linyup mobile app
 *
 * Firebase environment is determined by FIREBASE_PROJECT_ID.
 * Only FIREBASE_API_KEY needs to be provided via environment.
 *
 * Usage:
 *   pnpm start          -> loads .env.staging  (linyup-staging)
 *   pnpm run start:prod -> loads .env.production (linyup-prod)
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
      webAppUrl,
      eas: {
        projectId: easProjectId,
      },
    },
  }
}
