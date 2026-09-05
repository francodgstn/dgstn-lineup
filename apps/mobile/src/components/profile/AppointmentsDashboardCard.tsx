import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { Contact } from '../../types';
import { useTranslations } from '../../i18n';

interface Props {
  contact?: Contact | null;
  /** Opens the coach → activity → duration → day → time booking funnel
   *  (`AppointmentBookingModal`). This card is a promo entry point only — it
   *  does not fetch availability itself, so the funnel handles the loading /
   *  empty / error states once opened. */
  onOpenBooking: () => void;
}

/** "Book an appointment" promo for the dashboard. */
export const AppointmentsDashboardCard: React.FC<Props> = ({ contact, onOpenBooking }) => {
  const theme = useTheme();
  const t = useTranslations('Appointments');

  if (!contact?.teamId) return null;

  const gradientColors: readonly [string, string, ...string[]] = theme.dark
    ? ['#1e3a5f', '#2d1b4e']
    : ['#dbeafe', '#ede9fe'];

  const accentColor = theme.dark ? '#93c5fd' : '#3b82f6';
  const textColor = theme.dark ? '#e2e8f0' : '#1e3a5f';
  const subtleText = theme.dark ? '#94a3b8' : '#4a6080';

  return (
    <TouchableRipple onPress={onOpenBooking} borderless style={styles.wrapper}>
      <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <View style={styles.mainRow}>
          <View style={[styles.iconBadge, { backgroundColor: theme.dark ? 'rgba(147,197,253,0.15)' : 'rgba(59,130,246,0.12)' }]}>
            <Icon source="whistle" size={20} color={accentColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="labelLarge" style={{ color: textColor, fontWeight: '800' }}>
              {t('bookTitle')}
            </Text>
            <Text variant="labelSmall" style={{ color: subtleText, marginTop: 2 }}>
              {t('findTimeSubtitleNoPeriod')}
            </Text>
          </View>
          <Icon source="chevron-right" size={22} color={accentColor} />
        </View>
      </LinearGradient>
    </TouchableRipple>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  gradient: { borderRadius: 16, padding: 14 },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
