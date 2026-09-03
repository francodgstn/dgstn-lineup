import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../theme';

interface GradientBackgroundProps {
  children: React.ReactNode;
  style?: object;
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({ children, style }) => {
  // Linyup's stops, or the signed-in member's studio look (theme.ts).
  const colors = useAppTheme().gradient;

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
