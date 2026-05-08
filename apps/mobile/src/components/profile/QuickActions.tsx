import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple, useTheme } from 'react-native-paper';

interface QuickActionsProps {
  onShowQR: () => void;
  onOpenBooking: () => void;
  onOpenWebsite: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  onShowQR,
  onOpenBooking,
  onOpenWebsite,
}) => {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.actionsScroll}
      contentContainerStyle={styles.actionsScrollContent}
    >
      <TouchableRipple
        style={[styles.actionBox, { backgroundColor: theme.colors.elevation.level1 }]}
        onPress={onShowQR}
      >
        <View style={styles.actionBoxContent}>
          <Icon source="qrcode" size={32} color={theme.colors.primary} />
          <Text style={[styles.actionLabel, { color: theme.colors.onSurface }]}>My QR</Text>
        </View>
      </TouchableRipple>
      <TouchableRipple
        style={[styles.actionBox, { backgroundColor: theme.colors.elevation.level1 }]}
        onPress={onOpenBooking}
      >
        <View style={styles.actionBoxContent}>
          <Icon source="calendar-check" size={32} color={theme.colors.primary} />
          <Text style={[styles.actionLabel, { color: theme.colors.onSurface }]}>Book</Text>
        </View>
      </TouchableRipple>

      <TouchableRipple
        style={[styles.actionBox, { backgroundColor: theme.colors.elevation.level1 }]}
        onPress={onOpenWebsite}
      >
        <View style={styles.actionBoxContent}>
          <Icon source="web" size={32} color={theme.colors.primary} />
          <Text style={[styles.actionLabel, { color: theme.colors.onSurface }]}>Website</Text>
        </View>
      </TouchableRipple>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  actionsScroll: {
    marginTop: 4,
    marginBottom: 8,
    minHeight: 90,
  },
  actionsScrollContent: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  actionBox: {
    width: 80,
    height: 80,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    elevation: 1,
  },
  actionBoxContent: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  actionLabel: {
    fontSize: 13,
    marginTop: 4,
    fontWeight: '500',
    textAlign: 'center',
  },
});
