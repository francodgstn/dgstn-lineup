import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'react-native-paper';
import { gradientColors } from '../theme';

interface GradientBackgroundProps {
  children: React.ReactNode;
  style?: object;
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({ children, style }) => {
  const theme = useTheme();
  const colors = theme.dark ? gradientColors.dark : gradientColors.light;

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
