import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import { useMemo } from 'react';
import { AuthProvider } from './src/contexts/AuthContext';
import { I18nProvider } from './src/i18n';
import { TenantThemeProvider, useTenantTheme } from './src/contexts/TenantThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { buildTheme } from './src/theme';
import { resolveTenantTheme } from './src/utils/tenantTheme';

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error: error.toString() };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ fontSize: 18, color: 'red', marginBottom: 10 }}>
            Error Loading App
          </Text>
          <Text style={{ fontSize: 14, color: '#666' }}>
            {this.state.error}
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

// The theme is the system scheme overlaid with the signed-in member's studio
// look (TenantThemeContext → utils/tenantTheme.ts → theme.ts). The status bar
// follows the RESOLVED scheme, not the system's: an `ink` studio is dark in
// light mode too.
function ThemedApp() {
  const scheme = useColorScheme();
  const { brand } = useTenantTheme();

  const theme = useMemo(
    () => buildTheme(scheme === 'dark', resolveTenantTheme(brand, scheme === 'dark')),
    [scheme, brand]
  );

  return (
    <PaperProvider theme={theme}>
      {/* Outermost of the app providers: auth and the tenant theme both surface
          copy, so nothing below here should render a string before a language
          is chosen. */}
      <I18nProvider>
      <AuthProvider>
        <SafeAreaProvider>
          <AppNavigator />
        </SafeAreaProvider>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
      </AuthProvider>
      </I18nProvider>
    </PaperProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TenantThemeProvider>
        <ThemedApp />
      </TenantThemeProvider>
    </ErrorBoundary>
  );
}
