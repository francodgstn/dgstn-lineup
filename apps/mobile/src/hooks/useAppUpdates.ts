import * as Updates from 'expo-updates';

export function useAppUpdates() {
  const checkForUpdates = async () => {
    if (__DEV__) return;

    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      // best-effort — never block the app
    }
  };

  return { checkForUpdates };
}
