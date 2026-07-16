import React, { useState } from 'react';
import { StyleSheet, View, Alert } from 'react-native';
import { Card, Text, useTheme, Button, ActivityIndicator } from 'react-native-paper';
import { AppointmentWithStatus, Contact } from '../../types';
import { APPOINTMENT_BOOKING_ENABLED, FirestoreService } from '../../services/firestore';

interface AppointmentsCardProps {
  slots: AppointmentWithStatus[];
  contact?: Contact | null;
  onRefresh?: () => void;
}

function formatSlotTime(start: Date, end: Date): string {
  const dateStr = start.toLocaleDateString('default', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const startTime = start.toLocaleTimeString('default', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const endTime = end.toLocaleTimeString('default', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dateStr}  ${startTime}–${endTime}`;
}

export const AppointmentsCard: React.FC<AppointmentsCardProps> = ({ slots, contact, onRefresh }) => {
  const theme = useTheme();
  const [loadingSlotId, setLoadingSlotId] = useState<string | null>(null);

  const handleBook = async (slot: AppointmentWithStatus) => {
    if (!contact?.id || !contact?.teamId) {
      Alert.alert('Error', 'Missing contact details.');
      return;
    }
    Alert.alert(
      'Book appointment',
      `Book "${slot.activityName}" on ${formatSlotTime(slot.start, slot.end)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Book',
          onPress: async () => {
            setLoadingSlotId(slot.id);
            try {
              await FirestoreService.bookAppointment({
                teamId: contact.teamId!,
                slotId: slot.id,
                contactId: contact.id,
              });
              Alert.alert('Confirmed', 'Your appointment has been booked!');
              if (onRefresh) onRefresh();
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to book. Please try again.');
            } finally {
              setLoadingSlotId(null);
            }
          },
        },
      ]
    );
  };

  const handleCancel = async (slot: AppointmentWithStatus) => {
    if (!contact?.id) return;
    Alert.alert(
      'Cancel appointment',
      `Cancel your booking for "${slot.activityName}"?`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: async () => {
            setLoadingSlotId(slot.id);
            try {
              await FirestoreService.cancelAppointment({
                slotId: slot.id,
                contactId: contact.id,
              });
              Alert.alert('Cancelled', 'Your booking has been cancelled.');
              if (onRefresh) onRefresh();
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to cancel. Please try again.');
            } finally {
              setLoadingSlotId(null);
            }
          },
        },
      ]
    );
  };

  if (!slots.length) return null;

  return (
    <Card style={styles.card}>
      <Card.Title title="Appointments" titleVariant="titleMedium" />
      <Card.Content>
        {slots.map((slot) => {
          const isLoading = loadingSlotId === slot.id;
          const isBooked = slot.bookingStatus === 'booked';
          const isFull = slot.bookingStatus === 'full';
          const isCancelled = slot.bookingStatus === 'cancelled';
          // TODO(P4 follow-up): appointments are availability-only — no open slot
          // ever exists, so `slots` only holds the member's own bookings and the
          // Book affordance is gated off. Restore it with the listAvailability
          // picker (see APPOINTMENT_BOOKING_ENABLED in services/firestore.ts).
          const isAvailable = APPOINTMENT_BOOKING_ENABLED && slot.bookingStatus === 'available';

          return (
            <View key={slot.id} style={styles.slotRow}>
              <View style={styles.slotInfo}>
                <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
                  {slot.activityName}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {formatSlotTime(slot.start, slot.end)}
                </Text>
                {slot.providerName ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {slot.providerName}
                  </Text>
                ) : null}
                {slot.location ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {slot.location}
                  </Text>
                ) : null}
              </View>

              <View style={styles.slotAction}>
                {isLoading ? (
                  <ActivityIndicator size="small" />
                ) : isBooked ? (
                  <Button
                    mode="outlined"
                    compact
                    onPress={() => handleCancel(slot)}
                    textColor={theme.colors.error}
                    style={{ marginLeft: 8, borderRadius: 8 }}
                    labelStyle={{ fontSize: 10, fontWeight: '700', marginVertical: 4, marginHorizontal: 8 }}
                  >
                    Booked
                  </Button>
                ) : isFull ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Full
                  </Text>
                ) : isCancelled ? (
                  <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                    Cancelled
                  </Text>
                ) : isAvailable ? (
                  <Button
                    mode="contained"
                    compact
                    onPress={() => handleBook(slot)}
                    style={{ marginLeft: 8, borderRadius: 8 }}
                    labelStyle={{ fontSize: 10, fontWeight: '700', marginVertical: 4, marginHorizontal: 8 }}
                  >
                    Book
                  </Button>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
  },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  slotInfo: {
    flex: 1,
    marginRight: 8,
  },
  slotAction: {
    alignItems: 'flex-end',
    minWidth: 72,
  },
});
