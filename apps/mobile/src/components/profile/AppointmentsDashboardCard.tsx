import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { AppointmentWithStatus, Contact } from '../../types';
import { FirestoreService } from '../../services/firestore';

interface Props {
  slots: AppointmentWithStatus[];
  contact?: Contact | null;
  onRefresh?: () => void;
  onViewMore?: () => void;
}

export const AppointmentsDashboardCard: React.FC<Props> = ({ slots, contact, onRefresh, onViewMore }) => {
  const theme = useTheme();
  const [selectedSlot, setSelectedSlot] = useState<AppointmentWithStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const nextSlot = slots.find(s => s.bookingStatus === 'available');
  if (!nextSlot) return null;

  const closeModal = () => setSelectedSlot(null);

  const confirmBook = async () => {
    if (!selectedSlot || !contact?.id || !contact?.teamId) return;
    setLoading(true);
    try {
      await FirestoreService.bookAppointment({ teamId: contact.teamId!, slotId: selectedSlot.id, contactId: contact.id });
      closeModal();
      Alert.alert('Confirmed', 'Your appointment has been booked!');
      onRefresh?.();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to book. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const day = nextSlot.start.getDate();
  const weekday = nextSlot.start.toLocaleDateString('default', { weekday: 'short' });
  const month = nextSlot.start.toLocaleString('default', { month: 'short' }).toUpperCase();
  const startTime = nextSlot.start.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false });
  const endTime = nextSlot.end.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false });
  const moreCount = slots.filter(s => s.bookingStatus === 'available').length - 1;

  const gradientColors: readonly [string, string, ...string[]] = theme.dark
    ? ['#1e3a5f', '#2d1b4e']
    : ['#dbeafe', '#ede9fe'];

  const formatFullDate = (d: Date) =>
    d.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const formatTime = (d: Date) =>
    d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false });

  const accentColor = theme.dark ? '#93c5fd' : '#3b82f6';
  const textColor = theme.dark ? '#e2e8f0' : '#1e3a5f';
  const subtleText = theme.dark ? '#94a3b8' : '#4a6080';

  return (
    <>
      <View style={[styles.wrapper, { shadowColor: '#000' }]}>
        <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          {/* Single row: icon label | date | details | book */}
          <View style={styles.mainRow}>
            {/* Left: icon + label stacked */}
            <View style={styles.labelCol}>
              <View style={[styles.iconBadge, { backgroundColor: theme.dark ? 'rgba(147,197,253,0.15)' : 'rgba(59,130,246,0.12)' }]}>
                <Icon source="whistle" size={14} color={accentColor} />
              </View>
              <Text style={[styles.sectionLabel, { color: subtleText }]}>APPOINTMENTS</Text>
            </View>

            {/* Date block */}
            <View style={[styles.dateBlock, { backgroundColor: theme.dark ? 'rgba(147,197,253,0.12)' : 'rgba(59,130,246,0.1)', borderColor: theme.dark ? 'rgba(147,197,253,0.2)' : 'rgba(59,130,246,0.2)' }]}>
              <Text style={[styles.dateWeekday, { color: accentColor }]}>{weekday}</Text>
              <Text style={[styles.dateDay, { color: textColor }]}>{day}</Text>
              <Text style={[styles.dateMonth, { color: subtleText }]}>{month}</Text>
            </View>

            {/* Details */}
            <View style={styles.slotDetails}>
              <Text variant="labelLarge" style={{ color: textColor, fontWeight: '800' }} numberOfLines={1}>
                {nextSlot.activityName}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <Icon source="clock-outline" size={11} color={subtleText} />
                <Text variant="labelSmall" style={{ color: subtleText }}>{startTime} – {endTime}</Text>
              </View>
              {moreCount > 0 ? (
                <TouchableRipple onPress={onViewMore} borderless style={{ borderRadius: 4, marginTop: 2 }}>
                  <Text style={{ color: accentColor, fontWeight: '600', fontSize: 11 }}>
                    +{moreCount} more
                  </Text>
                </TouchableRipple>
              ) : null}
            </View>

            {/* Book button */}
            <Button
              mode="contained"
              compact
              onPress={() => setSelectedSlot(nextSlot)}
              style={[styles.bookBtn, { backgroundColor: accentColor }]}
              labelStyle={{ fontSize: 11, fontWeight: '700', color: '#fff', marginHorizontal: 10, marginVertical: 5 }}
            >
              Book
            </Button>
          </View>
        </LinearGradient>
      </View>

      {/* Booking invite modal */}
      <Modal visible={!!selectedSlot} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <View style={[styles.dateBadge, { backgroundColor: theme.colors.primaryContainer }]}>
              <Text style={[styles.badgeDay, { color: theme.colors.primary }]}>{selectedSlot?.start.getDate()}</Text>
              <Text style={[styles.badgeMonth, { color: theme.colors.primary }]}>
                {selectedSlot?.start.toLocaleString('default', { month: 'short' }).toUpperCase()}
              </Text>
            </View>

            <Text variant="headlineSmall" style={[styles.modalTitle, { color: theme.colors.onSurface }]}>
              {selectedSlot?.activityName}
            </Text>
            {selectedSlot?.providerName ? (
              <View style={styles.coachRow}>
                <Icon source="account-circle" size={16} color={theme.colors.onSurfaceVariant} />
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 6 }}>
                  with <Text style={{ fontWeight: '700', color: theme.colors.onSurface }}>{selectedSlot.providerName}</Text>
                </Text>
              </View>
            ) : null}

            <View style={[styles.detailBox, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.05)' : theme.colors.surfaceVariant, borderRadius: 12 }]}>
              <View style={styles.detailRow}>
                <Icon source="calendar-outline" size={16} color={theme.colors.primary} />
                <Text variant="bodySmall" style={[styles.detailText, { color: theme.colors.onSurface }]}>
                  {selectedSlot ? formatFullDate(selectedSlot.start) : ''}
                </Text>
              </View>
              <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.outlineVariant }]}>
                <Icon source="clock-outline" size={16} color={theme.colors.primary} />
                <Text variant="bodySmall" style={[styles.detailText, { color: theme.colors.onSurface }]}>
                  {selectedSlot ? `${formatTime(selectedSlot.start)} – ${formatTime(selectedSlot.end)}` : ''}
                </Text>
              </View>
              {selectedSlot?.location ? (
                <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.outlineVariant }]}>
                  <Icon source="map-marker-outline" size={16} color={theme.colors.primary} />
                  <Text variant="bodySmall" style={[styles.detailText, { color: theme.colors.onSurface }]}>
                    {selectedSlot.location}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Button mode="text" onPress={closeModal} style={{ flex: 1 }} disabled={loading}>Not now</Button>
              <Button mode="contained" style={{ flex: 1 }} onPress={confirmBook} loading={loading} disabled={loading}>
                Book it
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  gradient: { borderRadius: 16, padding: 12 },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  labelCol: { alignItems: 'center', gap: 4 },
  iconBadge: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 7, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  dateBlock: {
    width: 44,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  dateWeekday: { fontSize: 8, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  dateDay: { fontSize: 18, fontWeight: '900', lineHeight: 22 },
  dateMonth: { fontSize: 8, fontWeight: '600', letterSpacing: 0.5 },
  slotDetails: { flex: 1 },
  bookBtn: { borderRadius: 8 },
  // Modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', borderRadius: 24, padding: 24, alignItems: 'center', gap: 16 },
  dateBadge: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badgeDay: { fontSize: 28, fontWeight: '900', lineHeight: 32 },
  badgeMonth: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  modalTitle: { fontWeight: '800', textAlign: 'center' },
  coachRow: { flexDirection: 'row', alignItems: 'center', marginTop: -8 },
  detailBox: { width: '100%', overflow: 'hidden' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  detailText: { flex: 1, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 10, width: '100%' },
});
