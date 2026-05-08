import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text } from 'react-native';
import { MD3DarkTheme, MD3LightTheme, PaperProvider, adaptNavigationTheme, configureFonts } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import { useMemo } from 'react';
import merge from 'deepmerge';
import { AuthProvider } from './src/contexts/AuthContext';
import { AppNavigator } from './src/navigation/AppNavigator';

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

const fontConfig = {
  displayLarge: { fontFamily: 'System', fontWeight: '700' as const, letterSpacing: 0, lineHeight: 44, fontSize: 32 },
  headlineMedium: { fontFamily: 'System', fontWeight: '600' as const, letterSpacing: 0.15, lineHeight: 32, fontSize: 24 },
  titleLarge: { fontFamily: 'System', fontWeight: '600' as const, letterSpacing: 0, lineHeight: 28, fontSize: 22 },
  bodyLarge: { fontFamily: 'System', fontWeight: '400' as const, letterSpacing: 0.5, lineHeight: 24, fontSize: 16 },
  bodyMedium: { fontFamily: 'System', fontWeight: '400' as const, letterSpacing: 0.25, lineHeight: 20, fontSize: 14 },
  labelLarge: { fontFamily: 'System', fontWeight: '600' as const, letterSpacing: 0.1, lineHeight: 20, fontSize: 14 }
};

export default function App() {
  const scheme = useColorScheme();

  const theme = useMemo(() => {
    const isDark = scheme === 'dark';
    const base = isDark ? MD3DarkTheme : MD3LightTheme;
    return merge(base, {
      colors: isDark ? {
        // Dark mode — blue-based palette
        primary: '#5DB0FF',
        onPrimary: '#00315E',
        primaryContainer: '#004785',
        onPrimaryContainer: '#D1E4FF',
        secondary: '#BAC8DB',
        onSecondary: '#253140',
        secondaryContainer: '#3B4858',
        onSecondaryContainer: '#D6E3F7',
        tertiary: '#D4BEE6',
        onTertiary: '#392A49',
        tertiaryContainer: '#504061',
        onTertiaryContainer: '#F0DBFF',
        background: '#0F1419',
        onBackground: '#E1E2E8',
        surface: '#161B22',
        onSurface: '#E1E2E8',
        surfaceVariant: '#1E2630',
        onSurfaceVariant: '#C0C8D4',
        outline: '#8A919C',
        outlineVariant: '#3A4450',
        inverseSurface: '#E1E2E8',
        inverseOnSurface: '#2E3138',
        inversePrimary: '#005FAE',
        elevation: {
          level0: 'transparent',
          level1: '#1E2630',
          level2: '#242D38',
          level3: '#2A3542',
          level4: '#303C4A',
          level5: '#364452',
        },
        error: '#FFB4AB',
        onError: '#690005',
        errorContainer: '#93000A',
        onErrorContainer: '#FFDAD6',
      } : {
        // Light mode — blue-based palette
        primary: '#005FAE',
        onPrimary: '#FFFFFF',
        primaryContainer: '#D1E4FF',
        onPrimaryContainer: '#001B3A',
        secondary: '#535F70',
        onSecondary: '#FFFFFF',
        secondaryContainer: '#D7E3F7',
        onSecondaryContainer: '#101C2B',
        tertiary: '#6B5778',
        onTertiary: '#FFFFFF',
        tertiaryContainer: '#F2DAFF',
        onTertiaryContainer: '#251432',
        background: '#F8FAFB',
        onBackground: '#191C20',
        surface: '#FFFFFF',
        onSurface: '#191C20',
        surfaceVariant: '#E0E5EC',
        onSurfaceVariant: '#43474E',
        outline: '#73777F',
        outlineVariant: '#C3C7CF',
        inverseSurface: '#2E3138',
        inverseOnSurface: '#EFF0F7',
        inversePrimary: '#9ECAFF',
        elevation: {
          level0: 'transparent',
          level1: '#FFFFFF',
          level2: '#FFFFFF',
          level3: '#F5F7FA',
          level4: '#F0F3F7',
          level5: '#EBF0F5',
        },
        error: '#BA1A1A',
        onError: '#FFFFFF',
        errorContainer: '#FFDAD6',
        onErrorContainer: '#410002',
      },
      fonts: configureFonts({ config: fontConfig })
    });
  }, [scheme]);

  return (
    <ErrorBoundary>
      <PaperProvider theme={theme}>
        <AuthProvider>
          <SafeAreaProvider>
            <AppNavigator />
          </SafeAreaProvider>
          <StatusBar style="auto" />
        </AuthProvider>
      </PaperProvider>
    </ErrorBoundary>
  );
}
