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
  const projectId = process.env.FIREBASE_PROJECT_ID || 'linyup-staging'
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
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff'
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
      eas: {
        projectId: '' // TODO: set after creating new Expo project
      }
    }
  }
}
