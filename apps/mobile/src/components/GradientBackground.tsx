import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'react-native-paper';

interface GradientBackgroundProps {
  children: React.ReactNode;
  style?: object;
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({ children, style }) => {
  const theme = useTheme();
  const isDark = theme.dark;

  const colors = isDark
    ? [theme.colors.background, '#0D1B2A', '#1B2838'] as const
    : [theme.colors.background, '#EDF2FA', '#E0EAFC'] as const;

  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={[styles.gradient, style]}
    >
      {children}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
});
