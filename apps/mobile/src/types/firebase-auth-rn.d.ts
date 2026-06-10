import type { Persistence } from 'firebase/auth';

// getReactNativePersistence ships only in the react-native bundle of
// @firebase/auth, which Metro resolves at runtime via the "react-native"
// exports condition. The `firebase` wrapper's type declarations only cover the
// browser build, so tsc can't see it (firebase/firebase-js-sdk#7615).
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
