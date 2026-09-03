import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import { GradientBackground } from '../components/GradientBackground';
import type { UpdateGate } from '../utils/minVersion';

/**
 * Shown INSTEAD of the app when the build is older than the platform's
 * minimum (app_settings/mobile). There is deliberately no "continue anyway":
 * the gate is raised only when an old build can no longer follow the backend,
 * and letting it through would show a member errors it cannot explain.
 */
export const UpdateRequiredScreen: React.FC<{ gate: UpdateGate }> = ({ gate }) => {
  const theme = useTheme();
  return (
    <GradientBackground>
      <View style={styles.container} testID="update-required">
        <Text variant="headlineMedium" style={styles.title}>
          Update required
        </Text>
        <Text variant="bodyMedium" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
          {gate.message ?? 'This version of Linyup is no longer supported. Please update to keep using the app.'}
        </Text>
        <Text variant="bodySmall" style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
          {gate.current ? `You have ${gate.current}; ` : ''}
          {`version ${gate.minimum} or newer is required.`}
        </Text>
        {gate.storeUrl ? (
          <Button
            mode="contained"
            onPress={() => Linking.openURL(gate.storeUrl as string).catch(() => undefined)}
            style={styles.button}
          >
            Open the store
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
