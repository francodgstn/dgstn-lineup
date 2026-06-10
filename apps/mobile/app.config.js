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

const environments = {
  'demo-linyup': {
    authDomain: 'demo-linyup.firebaseapp.com',
    databaseURL: 'https://demo-linyup.firebaseio.com',
    projectId: 'demo-linyup',
    storageBucket: 'demo-linyup.appspot.com',
    messagingSenderId: 'demo'
  },
  'linyup-staging': {
    authDomain: 'linyup-staging.firebaseapp.com',
    databaseURL: 'https://linyup-staging.firebaseio.com',
    projectId: 'linyup-staging',
    storageBucket: 'linyup-staging.appspot.com',
    messagingSenderId: '' // TODO: set from Firebase console
  },
  'linyup-prod': {
    authDomain: 'linyup-prod.firebaseapp.com',
    databaseURL: 'https://linyup-prod.firebaseio.com',
    projectId: 'linyup-prod',
    storageBucket: 'linyup-prod.appspot.com',
    messagingSenderId: '' // TODO: set from Firebase console
  }
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

  const firebaseConfig = {
    ...envConfig,
    // The Auth/Firestore emulators don't validate the key; a non-empty placeholder
    // avoids the SDK throwing auth/invalid-api-key in local dev.
    apiKey: process.env.FIREBASE_API_KEY || 'demo-api-key'
  }

  return {
    ...config,
    name: 'Linyup',
    slug: 'linyup-student-app',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    scheme: 'linyup',
    runtimeVersion: {
      policy: 'appVersion'
    },
    // TODO: set EAS project ID after creating a new Expo project
    // updates: {
    //   url: 'https://u.expo.dev/<new-project-id>'
    // },
    plugins: ['expo-updates', '@react-native-community/datetimepicker'],
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff'
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.dgstn.linyup',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      adaptiveIcon: {
        // Foreground is a white swoosh on transparency — bg must be brand purple
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#6d28d9'
      },
      package: 'com.dgstn.linyup',
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      softwareKeyboardLayoutMode: 'resize'
    },
    web: {
      favicon: './assets/favicon.png'
    },
    extra: {
      firebase: firebaseConfig,
      useEmulators,
      eas: {
        projectId: '' // TODO: set after creating new Expo project
      }
    }
  }
}
