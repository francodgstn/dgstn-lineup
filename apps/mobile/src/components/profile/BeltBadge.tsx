import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

/**
 * A level's badge. Four ways to show one, in the same precedence the web uses
 * (`rankLevelBadge` in @linyup/shared): uploaded artwork, then an emoji, then a
 * split colour, then a solid one.
 *
 * A club identifies its levels the way its sport does — a belt colour here, a
 * sea animal at a swim school, a club's own artwork elsewhere — so this renders
 * all of them rather than assuming a belt.
 */
interface BeltBadgeProps {
  primaryColor: string;
  secondaryColor?: string;
  /** A single emoji standing for the level, e.g. 🐧. */
  emoji?: string;
  /** Uploaded badge artwork. Wins over `emoji` when both are set. */
  imageUrl?: string;
  size?: number;
}

export const BeltBadge: React.FC<BeltBadgeProps> = ({
  primaryColor,
  secondaryColor,
  emoji,
  imageUrl,
  size = 40
}) => {
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[
          styles.badge,
          { width: size, height: size, borderRadius: size / 2 }
        ]}
        resizeMode="cover"
      />
    );
  }

  if (emoji) {
    return (
      <View
        style={[
          styles.badge,
          styles.emojiBox,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: primaryColor
          }
        ]}
      >
        <Text style={{ fontSize: size * 0.55 }}>{emoji}</Text>
      </View>
    );
  }

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
  emojiBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
