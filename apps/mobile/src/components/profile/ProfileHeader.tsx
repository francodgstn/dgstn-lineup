import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, Icon, IconButton, Menu, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { Contact } from '../../types';
import { useWelcomeMessage } from '../../hooks/useWelcomeMessage';

interface ProfileHeaderProps {
  contact: Contact;
  initials: string;
  onShowQR: () => void;
  onScanTeamQR: () => void;
  onEditProfile: () => void;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  contact,
  initials,
  onShowQR,
  onScanTeamQR,
  onEditProfile,
}) => {
  const theme = useTheme();
  const welcomeMessage = useWelcomeMessage();
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<View>(null);

  const openMenu = () => {
    buttonRef.current?.measure((_fx, _fy, width, height, pageX, pageY) => {
      setMenuAnchor({ x: pageX + width, y: pageY + height });
      setMenuVisible(true);
    });
  };

  return (
    <View style={styles.headerContainer}>
      <View style={styles.leftSection}>
        {/* Wrapper sits outside TouchableRipple so the badge is never clipped */}
        <View style={styles.avatarWrapper}>
          <TouchableRipple onPress={onEditProfile} borderless style={styles.avatarRipple}>
            <View style={styles.avatarContainer}>
              {contact.avatar_url ? (
                <Avatar.Image
                  source={{ uri: contact.avatar_url }}
                  size={60}
                />
              ) : (
                <Avatar.Text
                  label={initials}
                  size={60}
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  color={theme.colors.onPrimaryContainer}
                />
              )}
            </View>
          </TouchableRipple>
          <View style={[styles.editBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.background }]}
                pointerEvents="none">
            <Icon source="pencil" size={10} color="#fff" />
          </View>
        </View>
        <View style={styles.nameSection}>
          <Text variant="titleLarge" style={styles.userName} numberOfLines={2}>
            {`${contact.firstname || ''} ${contact.lastname || ''}`.trim()}
          </Text>
          {!!welcomeMessage && (
            <Text variant="bodyMedium" style={[styles.greeting, { color: theme.colors.onSurfaceVariant }]}>
              {welcomeMessage}
            </Text>
          )}
        </View>
      </View>

      <View ref={buttonRef}>
        <IconButton
          icon="qrcode"
          size={28}
          mode="contained"
          containerColor={theme.colors.primaryContainer}
          iconColor={theme.colors.primary}
          onPress={openMenu}
          style={styles.qrButton}
        />
      </View>
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={menuAnchor}
      >
        <Menu.Item
          leadingIcon="qrcode-scan"
          onPress={() => { setMenuVisible(false); onScanTeamQR(); }}
          title="Scan team QR"
        />
        <Menu.Item
          leadingIcon="qrcode"
          onPress={() => { setMenuVisible(false); onShowQR(); }}
          title="Show my QR"
        />
      </Menu>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: 10,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatarRipple: {
    borderRadius: 30,
  },
  avatarContainer: {},
  editBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameSection: {
    justifyContent: 'center',
    flex: 1,
  },
  userName: {
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  greeting: {
    opacity: 0.8,
  },
  qrButton: {
    borderRadius: 12,
    margin: 0,
    width: 50,
    height: 50,
  },
});
