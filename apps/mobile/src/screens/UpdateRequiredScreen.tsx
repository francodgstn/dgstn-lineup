import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import { GradientBackground } from '../components/GradientBackground';
import type { UpdateGate } from '../utils/minVersion';
import { useTranslations } from '../i18n';

/**
 * Shown INSTEAD of the app when the build is older than the platform's
 * minimum (app_settings/mobile). There is deliberately no "continue anyway":
 * the gate is raised only when an old build can no longer follow the backend,
 * and letting it through would show a member errors it cannot explain.
 */
export const UpdateRequiredScreen: React.FC<{ gate: UpdateGate }> = ({ gate }) => {
  const theme = useTheme();
  const t = useTranslations('UpdateRequired');
  return (
    <GradientBackground>
      <View style={styles.container} testID="update-required">
        <Text variant="headlineMedium" style={styles.title}>
          {t('title')}
        </Text>
        <Text variant="bodyMedium" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
          {/* gate.message, when present, is the operator's own copy
              (app_settings/mobile.update_message) — never translated here. */}
          {gate.message ?? t('fallbackMessage')}
        </Text>
        <Text variant="bodySmall" style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
          {gate.current ? t('youHavePrefix', { version: gate.current }) : ''}
          {t('versionRequired', { minimum: gate.minimum })}
        </Text>
        {gate.storeUrl ? (
          <Button
            mode="contained"
            onPress={() => Linking.openURL(gate.storeUrl as string).catch(() => undefined)}
            style={styles.button}
          >
            {t('openStore')}
          </Button>
        ) : null}
      </View>
    </GradientBackground>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  title: { fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  body: { textAlign: 'center', marginBottom: 8 },
  meta: { textAlign: 'center', marginBottom: 24 },
  button: { minWidth: 200 },
});
