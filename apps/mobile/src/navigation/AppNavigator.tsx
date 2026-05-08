import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoginScreen } from '../screens/LoginScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { useAuth } from '../contexts/AuthContext';
import { ActivityIndicator, AppState, View, StyleSheet } from 'react-native';
import { FirestoreService } from '../services/firestore';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useAppUpdates } from '../hooks/useAppUpdates';

export type RootStackParamList = {
  Login: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  const { isAuthenticated, isInitializing, contact } = useAuth();
  const appState = useRef(AppState.currentState);
  const { checkForUpdates } = useAppUpdates();
  const appVersion = Constants.expoConfig?.version;
  const otaDiagnostics = {
    ota_runtime_version: Updates.runtimeVersion ?? null,
    ota_channel: Updates.channel ?? null,
    ota_is_embedded: Updates.isEmbeddedLaunch,
    ota_update_id: Updates.updateId ?? null,
  };

  // Update last_seen_at + app_version whenever the app comes to the foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        checkForUpdates();
        if (contact?.id) {
          FirestoreService.updateLastSeen(contact.id, appVersion, otaDiagnostics).catch(() => undefined);
        }
      }
      appState.current = nextState;
    });

    // Also record on first mount (app open from cold start)
    checkForUpdates();
    if (contact?.id) {
      FirestoreService.updateLastSeen(contact.id, appVersion, otaDiagnostics).catch(() => undefined);
    }

    return () => subscription.remove();
  }, [contact?.id]);

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {isAuthenticated ? (
          <Stack.Navigator
            key="authenticated"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Profile" component={ProfileScreen} />
          </Stack.Navigator>
        ) : (
          <Stack.Navigator
            key="unauthenticated"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Login" component={LoginScreen} />
          </Stack.Navigator>
        )}
      </SafeAreaView>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
});
