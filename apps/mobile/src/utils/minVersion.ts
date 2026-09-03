import { isVersionBelow, type MobileAppSettings } from '@linyup/shared';

/** What the update-required screen renders, or null when the app may run. */
export interface UpdateGate {
  minimum: string;
  current: string | null;
  message: string | null;
  storeUrl: string | null;
}

/**
 * THE decision behind `app_settings/mobile.min_supported_version`, with no IO
 * in it. Fails OPEN on every doubt: no settings, no minimum, an unparseable
 * version on either side, or an unknown current version all mean "run" — the
 * gate exists to retire a build that can no longer follow the backend, and a
 * typo in a settings document must never lock every member out.
 */
export function decideUpdateGate(
  settings: Pick<MobileAppSettings, 'min_supported_version' | 'update_message' | 'store_url_ios' | 'store_url_android'> | null | undefined,
  currentVersion: string | null | undefined,
  platform: 'ios' | 'android' | 'web' | string,
): UpdateGate | null {
  if (!settings || !settings.min_supported_version) return null;
  if (!isVersionBelow(currentVersion, settings.min_supported_version)) return null;
  const storeUrl =
    platform === 'ios' ? settings.store_url_ios ?? null : platform === 'android' ? settings.store_url_android ?? null : null;
  return {
    minimum: settings.min_supported_version,
    current: currentVersion ?? null,
    message: settings.update_message ?? null,
    storeUrl,
  };
}
