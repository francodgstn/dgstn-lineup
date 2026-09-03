import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { fetchMobileAppSettings } from '../services/appSettings';
import { decideUpdateGate, type UpdateGate } from '../utils/minVersion';

/**
 * Is this build older than `app_settings/mobile.min_supported_version`?
 *
 * The app renders IMMEDIATELY and the gate lands when the read returns — a
 * member offline, or on a slow link, must not stare at a spinner for a policy
 * document. Re-checked on demand (the navigator calls it on foreground, next
 * to the OTA check), so a minimum raised while the app is open takes effect
 * the next time it comes back.
 */
export function useMinVersionGate(): { gate: UpdateGate | null; recheck: () => void } {
  const [gate, setGate] = useState<UpdateGate | null>(null);

  const recheck = useCallback(() => {
    fetchMobileAppSettings()
      .then((settings) => setGate(decideUpdateGate(settings, Constants.expoConfig?.version ?? null, Platform.OS)))
      .catch(() => setGate(null));
  }, []);

  useEffect(() => {
    recheck();
  }, [recheck]);

  return { gate, recheck };
}
