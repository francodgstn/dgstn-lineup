/**
 * Expo dynamic configuration — Lineup mobile app
 *
 * Firebase environment is determined by FIREBASE_PROJECT_ID.
 * Only FIREBASE_API_KEY needs to be provided via environment.
 *
 * Usage:
 *   pnpm start          -> loads .env.staging  (lineup-staging)
 *   pnpm run start:prod -> loads .env.production (lineup-prod)
 */

const environments = {
  'lineup-staging': {
    authDomain: 'lineup-staging.firebaseapp.com',
    databaseURL: 'https://lineup-staging.firebaseio.com',
    projectId: 'lineup-staging',
    storageBucket: 'lineup-staging.appspot.com',
    messagingSenderId: '' // TODO: set from Firebase console
  },
  'lineup-prod': {
    authDomain: 'lineup-prod.firebaseapp.com',
    databaseURL: 'https://lineup-prod.firebaseio.com',
    projectId: 'lineup-prod',
    storageBucket: 'lineup-prod.appspot.com',
    messagingSenderId: '' // TODO: set from Firebase console
  }
}

export default ({ config }) => {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'lineup-staging'
  const envConfig = environments[projectId]

  if (!envConfig) {
    throw new Error(`Unknown FIREBASE_PROJECT_ID: ${projectId}`)
  }

  const firebaseConfig = {
    ...envConfig,
    apiKey: process.env.FIREBASE_API_KEY
  }

  return {
    ...config,
    name: 'Lineup',
    slug: 'lineup-student-app',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    scheme: 'lineup',
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
      bundleIdentifier: 'com.dgstn.lineup',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff'
      },
      package: 'com.dgstn.lineup',
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      softwareKeyboardLayoutMode: 'resize'
    },
    web: {
      favicon: './assets/favicon.png'
    },
    extra: {
      firebase: firebaseConfig,
      eas: {
        projectId: '' // TODO: set after creating new Expo project
      }
    }
  }
}
