import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text, useTheme, TouchableRipple, Icon } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { TeamPublicProfile } from '../../types';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Extract a bare @handle from any Instagram URL or plain handle string. */
function parseHandle(value: string): string {
  try {
    const url = new URL(value);
    // e.g. https://www.instagram.com/myteam/ → "myteam"
    const parts = url.pathname.replace(/\/$/, '').split('/');
    const handle = parts[parts.length - 1];
    return handle ? `@${handle}` : value;
  } catch {
    // Not a URL — treat as plain handle, strip leading @
    return `@${value.replace(/^@/, '')}`;
  }
}

/** Open the Instagram app; fall back to the web URL. */
async function openInstagram(rawUrl: string) {
  let username = rawUrl;
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.replace(/\/$/, '').split('/');
    username = parts[parts.length - 1] || rawUrl;
  } catch {
    username = rawUrl.replace(/^@/, '');
  }

  const webUrl = rawUrl.startsWith('http')
    ? rawUrl
    : `https://www.instagram.com/${username}`;

  // Linking.canOpenURL throws on Android 11+ for undeclared schemes — skip it.
  // Try the native app URL directly; if the OS can't handle it, fall back to web.
  try {
    await Linking.openURL(`instagram://user?username=${username}`);
  } catch {
    await Linking.openURL(webUrl);
  }
}

// ─── Instagram gradient ───────────────────────────────────────────────────────

const IG_GRADIENT: [string, string, string] = ['#833ab4', '#fd1d1d', '#fcb045'];

// ─── component ────────────────────────────────────────────────────────────────

interface InstagramCardProps {
  teamProfile: TeamPublicProfile;
}

export const InstagramCard: React.FC<InstagramCardProps> = ({ teamProfile }) => {
  const theme = useTheme();

  const igLink = teamProfile.socialLinks?.find(
    (l) => l.platform === 'instagram'
  );
  if (!igLink) return null;

  const handle = parseHandle(igLink.url);

  return (
    <TouchableRipple
      onPress={() => openInstagram(igLink.url)}
      style={styles.wrapper}
      borderless
    >
      <LinearGradient
        colors={IG_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradientInner}
      >
        {/* Left: icon + text */}
        <View style={styles.left}>
          <View style={styles.iconCircle}>
            <Icon source="instagram" size={22} color="#fff" />
          </View>
          <View style={styles.textBlock}>
            <Text variant="titleSmall" style={styles.title}>
              Follow us on Instagram
            </Text>
            <Text variant="bodySmall" style={styles.subtitle}>
              {handle}
            </Text>
          </View>
        </View>

        {/* Right: follow chip */}
        <View style={styles.right}>
          <View style={styles.followChip}>
            <Text variant="labelSmall" style={styles.followLabel}>
              Follow
            </Text>
          </View>
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
    // overflow must stay visible so the Android ripple renders outside the bounds
  },
  gradientInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
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
    color: 'rgba(255,255,255,0.85)',
  },
  right: {
    marginLeft: 12,
  },
  followChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  followLabel: {
    color: '#fff',
    fontWeight: '600',
  },
});
