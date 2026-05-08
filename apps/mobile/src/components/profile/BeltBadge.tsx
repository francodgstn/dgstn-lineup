import React from 'react';
import { StyleSheet, View } from 'react-native';

interface BeltBadgeProps {
  primaryColor: string;
  secondaryColor?: string;
  size?: number;
}

export const BeltBadge: React.FC<BeltBadgeProps> = ({
  primaryColor,
  secondaryColor,
  size = 40
}) => {
  if (secondaryColor) {
    return (
      <View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: primaryColor,
            overflow: 'hidden'
          }
        ]}
      >
        <View
          style={[
            styles.split,
            {
              width: size,
              height: size / 2,
              backgroundColor: secondaryColor,
              position: 'absolute',
              bottom: 0
            }
          ]}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: primaryColor
        }
      ]}
    />
  );
};

const styles = StyleSheet.create({
  badge: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  split: {},
});
