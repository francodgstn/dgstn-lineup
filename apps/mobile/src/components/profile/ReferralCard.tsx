import React, { useState } from 'react';
import { Share, StyleSheet, View, ActivityIndicator } from 'react-native';
import { Text, useTheme, TouchableRipple, Icon } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { FirestoreService } from '../../services/firestore';
import { ReferralInfo } from '../../types';

interface ReferralCardProps {
  rewardedCount: number;
}

export const ReferralCard: React.FC<ReferralCardProps> = ({ rewardedCount }) => {
  const theme = useTheme();
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const gradient: [string, string] = theme.dark
    ? ['#1D4ED8', '#7C3AED']  // Blue -> Violet (dark)
    : ['#3B82F6', '#8B5CF6']; // Blue -> Purple (light)

  async function handleShare() {
    setLoading(true);
    try {
      let info = referralInfo;
      if (!info) {
        info = await FirestoreService.getMyReferralCode();
        if (info) setReferralInfo(info);
      }
      if (!info) return;

      await Share.share({
        message: info.referralUrl,
        url: info.referralUrl,
      });
    } catch {
      // Share dialog dismissed or error — silently ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <TouchableRipple
      onPress={handleShare}
      disabled={loading}
      style={styles.wrapper}
      borderless
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {/* Left: icon + text */}
        <View style={styles.left}>
          <View style={styles.iconCircle}>
            <Icon source="gift-outline" size={22} color="#fff" />
          </View>
          <View style={styles.textBlock}>
            <Text variant="titleSmall" style={styles.title}>
              Invite a Friend
            </Text>
            <Text variant="bodySmall" style={styles.subtitle}>
              {rewardedCount > 0
                ? `${rewardedCount} reward${rewardedCount > 1 ? 's' : ''} earned · Share again`
                : 'Share your link · Earn a reward'}
            </Text>
          </View>
        </View>

        {/* Right: share button */}
        <View style={styles.right}>
          {loading ? (
            <ActivityIndicator color="#fff" size={18} />
          ) : (
            <View style={styles.shareChip}>
              <Icon source="share-variant" size={14} color="#fff" />
              <Text variant="labelSmall" style={styles.shareLabel}>
                Share
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>
    </TouchableRipple>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: '#fff',
    fontWeight: '700',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.8)',
  },
  right: {
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  shareLabel: {
    color: '#fff',
    fontWeight: '600',
  },
});
