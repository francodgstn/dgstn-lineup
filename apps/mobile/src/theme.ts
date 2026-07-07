import { MD3DarkTheme, MD3LightTheme, configureFonts } from 'react-native-paper'
import merge from 'deepmerge'

// Linyup brand — purple accent (hue ~292, matching the web app's oklch primary).
// All MD3 color roles derived from this base.

const fontConfig = {
  displayLarge: { fontFamily: 'System', fontWeight: '700' as const, letterSpacing: 0, lineHeight: 44, fontSize: 32 },
  headlineMedium: { fontFamily: 'System', fontWeight: '600' as const, letterSpacing: 0.15, lineHeight: 32, fontSize: 24 },
  titleLarge: { fontFamily: 'System', fontWeight: '600' as const, letterSpacing: 0, lineHeight: 28, fontSize: 22 },
  bodyLarge: { fontFamily: 'System', fontWeight: '400' as const, letterSpacing: 0.5, lineHeight: 24, fontSize: 16 },
  bodyMedium: { fontFamily: 'System', fontWeight: '400' as const, letterSpacing: 0.25, lineHeight: 20, fontSize: 14 },
  labelLarge: { fontFamily: 'System', fontWeight: '600' as const, letterSpacing: 0.1, lineHeight: 20, fontSize: 14 },
}

const lightColors = {
  primary: '#7C3AED',
  onPrimary: '#FFFFFF',
  primaryContainer: '#EDE5FF',
  onPrimaryContainer: '#250066',
  secondary: '#625B71',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E8DEF8',
  onSecondaryContainer: '#1D192B',
  tertiary: '#7D5260',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFD8E4',
  onTertiaryContainer: '#31111D',
  background: '#FAFAFF',
  onBackground: '#1C1B1F',
  surface: '#FFFFFF',
  onSurface: '#1C1B1F',
  surfaceVariant: '#E7E0EC',
  onSurfaceVariant: '#49454F',
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
  inverseSurface: '#313033',
  inverseOnSurface: '#F4EFF4',
  inversePrimary: '#CFBCFF',
  elevation: {
    level0: 'transparent',
    level1: '#FFFFFF',
    level2: '#FFFFFF',
    level3: '#F7F2FA',
    level4: '#F3EDF7',
    level5: '#EFE9F4',
  },
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
}

const darkColors = {
  primary: '#CFBCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',
  secondary: '#CCC2DC',
  onSecondary: '#332D41',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',
  tertiary: '#EFB8C8',
  onTertiary: '#492532',
  tertiaryContainer: '#633B48',
  onTertiaryContainer: '#FFD8E4',
  background: '#121015',
  onBackground: '#E6E1E5',
  surface: '#1A1720',
  onSurface: '#E6E1E5',
  surfaceVariant: '#252030',
  onSurfaceVariant: '#CAC4D0',
  outline: '#938F99',
  outlineVariant: '#49454F',
  inverseSurface: '#E6E1E5',
  inverseOnSurface: '#313033',
  inversePrimary: '#6750A4',
  elevation: {
    level0: 'transparent',
    level1: '#252030',
    level2: '#2B2535',
    level3: '#322B3C',
    level4: '#383144',
    level5: '#3E374B',
  },
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
}

export function buildTheme(isDark: boolean) {
  const base = isDark ? MD3DarkTheme : MD3LightTheme
  return merge(base, {
    colors: isDark ? darkColors : lightColors,
    fonts: configureFonts({ config: fontConfig }),
  })
}

// Gradient stops used by GradientBackground and any future branded surfaces.
export const gradientColors = {
  light: ['#FAFAFF', '#F0E8FF', '#E8DCFF'] as const,
  dark: ['#121015', '#1A1028', '#221838'] as const,
}
