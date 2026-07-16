import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { AppointmentWithStatus, Contact } from '../../types';
import { FirestoreService } from '../../services/firestore';

interface Props {
  slots: AppointmentWithStatus[];
  contact?: Contact | null;
  onRefresh?: () => void;
  open?: boolean;
}

const CARD_WIDTH = 108;

export const AppointmentsCarousel: React.FC<Props> = ({ slots, contact, onRefresh, open }) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AppointmentWithStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const chevronAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open && !expanded) {
      setExpanded(true);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(chevronAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [open]);

  const toggleExpanded = () => {
    const toValue = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue, duration: 260, useNativeDriver: true }),
      Animated.timing(chevronAnim, { toValue, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const chevronRotate = chevronAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  const isBooked = selectedSlot?.bookingStatus === 'booked';

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

  const confirmCancel = async () => {
    if (!selectedSlot || !contact?.id) return;
    setLoading(true);
    try {
      await FirestoreService.cancelAppointment({ slotId: selectedSlot.id, contactId: contact.id });
      closeModal();
      Alert.alert('Cancelled', 'Your booking has been cancelled.');
      onRefresh?.();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to cancel. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const availableCount = slots.filter(s => s.bookingStatus === 'available').length;
  const bookedCount = slots.filter(s => s.bookingStatus === 'booked').length;

  const renderCard = ({ item: slot }: { item: AppointmentWithStatus }) => {
    const slotIsBooked = slot.bookingStatus === 'booked';
    const isFull = slot.bookingStatus === 'full';
    const isCancelled = slot.bookingStatus === 'cancelled';
    const isAvailable = slot.bookingStatus === 'available';

    const day = slot.start.getDate();
    const month = slot.start.toLocaleString('default', { month: 'short' }).toUpperCase();
    const startTime = slot.start.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false });
    const endTime = slot.end.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false });

    const headerBg = slotIsBooked
      ? (theme.dark ? 'rgba(34,197,94,0.25)' : '#DCFCE7')
      : isFull || isCancelled
        ? theme.colors.surfaceVariant
        : theme.colors.primaryContainer;
    const headerColor = slotIsBooked
      ? '#16A34A'
      : isFull || isCancelled
        ? theme.colors.onSurfaceVariant
        : theme.colors.primary;

    return (
      <Pressable
        onPress={(isAvailable || slotIsBooked) ? () => setSelectedSlot(slot) : undefined}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, opacity: pressed ? 0.85 : 1 }
        ]}
      >
        <View style={[styles.dateHeader, { backgroundColor: headerBg }]}>
          <Text style={[styles.monthText, { color: headerColor }]}>{month}</Text>
          <Text style={[styles.dayText, { color: headerColor }]}>{day}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }} numberOfLines={1}>
            {startTime}–{endTime}
          </Text>
          <Text style={{ color: theme.colors.onSurface, fontWeight: '600', fontSize: 11, lineHeight: 14, marginTop: 2 }} numberOfLines={2}>
            {slot.activityName}
          </Text>
        </View>
        <View style={styles.cardFooter}>
          {slotIsBooked ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon source="check-circle" size={12} color="#16A34A" />
              <Text style={{ color: '#16A34A', fontWeight: '700', fontSize: 10 }}>Booked</Text>
            </View>
          ) : isFull ? (
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>Full</Text>
          ) : isCancelled ? (
            <Text style={{ color: theme.colors.error, fontSize: 10 }}>Cancelled</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon source="calendar-plus" size={12} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 10 }}>Book</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  const formatFullDate = (d: Date) =>
    d.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const formatTime = (d: Date) =>
    d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false });

  const subtitle = bookedCount > 0
    ? `You have ${bookedCount} booked appointment${bookedCount > 1 ? 's' : ''}${availableCount > 0 ? ` · ${availableCount} more available` : ''}.`
    : `${availableCount} slot${availableCount !== 1 ? 's' : ''} available to book with your coach.`;

  return (
    <>
      {/* Intro card — always visible, tappable */}
      <TouchableRipple onPress={toggleExpanded} borderless style={[styles.introCard, { backgroundColor: theme.colors.primaryContainer }]}>
        <View style={styles.introInner}>
          <View style={[styles.introIcon, { backgroundColor: theme.colors.primary }]}>
            <Icon source="whistle" size={20} color={theme.colors.onPrimary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="titleSmall" style={{ color: theme.colors.onPrimaryContainer, fontWeight: '800' }}>
              Book an appointment
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.primary, opacity: 0.85, lineHeight: 16 }}>
              {subtitle}
            </Text>
          </View>
          <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
            <Icon source="chevron-right" size={20} color={theme.colors.primary} />
          </Animated.View>
        </View>
      </TouchableRipple>

      {/* Slot cards — fade in on tap */}
      <Animated.View style={{ opacity: fadeAnim, display: expanded ? 'flex' : 'none' }}>
        <FlatList
          data={slots}
          keyExtractor={(s) => s.id}
          renderItem={renderCard}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
        />
      </Animated.View>

      {/* Booking invite modal */}
      <Modal visible={!!selectedSlot} transparent animationType="fade" onRequestClose={closeModal}>
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <View style={[styles.dateBadge, { backgroundColor: isBooked ? (theme.dark ? 'rgba(34,197,94,0.2)' : '#DCFCE7') : theme.colors.primaryContainer }]}>
              <Text style={[styles.badgeDay, { color: isBooked ? '#16A34A' : theme.colors.primary }]}>
                {selectedSlot?.start.getDate()}
              </Text>
              <Text style={[styles.badgeMonth, { color: isBooked ? '#16A34A' : theme.colors.primary }]}>
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

            {isBooked ? (
              <>
                <View style={[styles.bookedBanner, { backgroundColor: theme.dark ? 'rgba(34,197,94,0.15)' : '#F0FDF4' }]}>
                  <Icon source="check-circle" size={16} color="#16A34A" />
                  <Text variant="labelMedium" style={{ color: '#16A34A', marginLeft: 6, fontWeight: '700' }}>You're booked!</Text>
                </View>
                <View style={styles.actions}>
                  <Button mode="text" onPress={closeModal} style={{ flex: 1 }}>Close</Button>
                  <Button mode="outlined" textColor={theme.colors.error} style={{ flex: 1, borderColor: theme.colors.error }} onPress={confirmCancel} loading={loading} disabled={loading}>
                    Cancel booking
                  </Button>
                </View>
              </>
            ) : (
              <View style={styles.actions}>
                <Button mode="text" onPress={closeModal} style={{ flex: 1 }} disabled={loading}>Not now</Button>
                <Button mode="contained" style={{ flex: 1 }} onPress={confirmBook} loading={loading} disabled={loading}>
                  Book it
                </Button>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  introCard: { borderRadius: 16, overflow: 'hidden' },
  introInner: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  introIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  list: { paddingTop: 10, paddingBottom: 4 },
  card: { width: CARD_WIDTH, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  dateHeader: { alignItems: 'center', paddingVertical: 10 },
  monthText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  dayText: { fontSize: 26, fontWeight: '900', lineHeight: 30 },
  cardBody: { paddingHorizontal: 10, paddingTop: 8, gap: 2, flex: 1 },
  cardFooter: { paddingHorizontal: 10, paddingBottom: 10, paddingTop: 6 },
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
  bookedBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, width: '100%', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, width: '100%' },
});
