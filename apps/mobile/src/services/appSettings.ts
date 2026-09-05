import { doc, getDoc } from 'firebase/firestore';
import { APP_SETTINGS_COLLECTION, MOBILE_SETTINGS_DOC, type MobileAppSettings } from '@linyup/shared';
import { db } from '../config/firebase';

/**
 * `app_settings/mobile` — the member app's platform policy, world-readable
 * (firestore.rules) so it can be read before sign-in. Null on ANY failure:
 * offline, a rules mismatch, a missing doc — the min-version gate fails open
 * (utils/minVersion.ts), and this read must never delay or block the app.
 */
export async function fetchMobileAppSettings(): Promise<MobileAppSettings | null> {
  try {
    const snap = await getDoc(doc(db, APP_SETTINGS_COLLECTION, MOBILE_SETTINGS_DOC));
    return snap.exists() ? (snap.data() as MobileAppSettings) : null;
  } catch (error) {
    console.warn('[appSettings] could not read app_settings/mobile — no gate applied', error);
    return null;
  }
}
