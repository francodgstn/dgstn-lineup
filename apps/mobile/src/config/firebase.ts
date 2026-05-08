import { initializeApp } from 'firebase/app';
import { Platform } from 'react-native';
import { getFirestore } from 'firebase/firestore';
import { getFunctions as getFirebaseFunctions } from 'firebase/functions';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/**
 * Default region for Cloud Functions
 * All functions are deployed to this region
 */
const FUNCTIONS_REGION = 'europe-west6'; // Zurich, Switzerland

/**
 * Firebase configuration loaded from Expo Constants
 * Set via environment variables in eas.json build profiles
 */
const firebaseConfig = Constants.expoConfig?.extra?.firebase;

if (!firebaseConfig) {
  throw new Error(
    'Firebase configuration not found. Ensure FIREBASE_* environment variables are set in eas.json or .env file.'
  );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Auth with native persistence when available
export const auth = Platform.OS === 'web'
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });

/**
 * Get Firebase Functions instance configured for the correct region
 * @returns Functions instance for europe-west6
 */
export function getFunctions() {
  return getFirebaseFunctions(app, FUNCTIONS_REGION);
}

export default app;
