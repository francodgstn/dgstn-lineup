// Pure builder for `Contact.mobile_app` (MobileAppTelemetry, @linyup/shared) —
// what `updateLastSeen` writes on foreground. Kept separate from
// `AppNavigator.tsx` so the payload SHAPE is unit-testable without mounting
// React Native. The self-update rules arm admits exactly
// `['weight','last_seen_at','mobile_app']` — every key here must stay inside
// that `mobile_app` map, never spread onto the contact document directly.
import type { MobileAppTelemetry } from '../types';

export interface AppUpdatesInfo {
  runtimeVersion: string | null;
  channel: string | null;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
}

export function buildMobileAppTelemetry(appVersion: string | undefined, updates: AppUpdatesInfo): MobileAppTelemetry {
  return {
    // OMIT the key rather than write `undefined`: the app's Firestore client is
    // created without `ignoreUndefinedProperties`, so an undefined value makes
    // `updateDoc` reject the WHOLE write — last_seen_at included.
    ...(appVersion ? { version: appVersion } : {}),
    ota_runtime_version: updates.runtimeVersion,
    ota_channel: updates.channel,
    ota_is_embedded: updates.isEmbeddedLaunch,
    ota_update_id: updates.updateId,
  };
}
