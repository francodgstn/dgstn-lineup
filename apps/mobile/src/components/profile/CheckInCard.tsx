import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Icon, Text, useTheme } from 'react-native-paper';
import { TeamPublicProfile } from '../../types';

interface CheckInCardProps {
  teamProfile: TeamPublicProfile | null;
  onCheckIn: () => void;
}

export const CheckInCard: React.FC<CheckInCardProps> = ({
  teamProfile,
  onCheckIn,
}) => {
  const theme = useTheme();

  return (
    <Card style={[styles.card, { backgroundColor: theme.colors.elevation.level1 }]}>
      <Card.Content style={styles.cardContent}>
        <View style={styles.leftSection}>
          <View style={[styles.iconContainer, { backgroundColor: theme.colors.primaryContainer }]}>
            <Icon source="map-marker" size={20} color={theme.colors.primary} />
          </View>
          <View style={styles.textSection}>
            <Text variant="labelSmall" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
              CURRENT DOJO
            </Text>
            <Text variant="titleMedium" style={styles.dojoName}>
              {teamProfile?.name || 'Hwalmoodo Dojo'}
            </Text>
          </View>
        </View>

        <Button
          mode="contained"
          onPress={onCheckIn}
          style={styles.checkInButton}
          labelStyle={styles.buttonLabel}
          icon="qrcode-scan"
        >
          SCAN QR
        </Button>
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    elevation: 0,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textSection: {
    justifyContent: 'center',
  },
  label: {
    letterSpacing: 1,
    opacity: 0.7,
  },
  dojoName: {
    fontWeight: '700',
    marginTop: -2,
  },
  checkInButton: {
    borderRadius: 8,
    minWidth: 90,
  },
  buttonLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginHorizontal: 0,
  },
});
