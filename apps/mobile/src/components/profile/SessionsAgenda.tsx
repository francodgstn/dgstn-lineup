import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Icon, IconButton, Text, useTheme } from 'react-native-paper';
import { SessionPublicProfile } from '../../types';

interface SessionsAgendaProps {
  sessions: SessionPublicProfile[];
  selectedDate: Date;
  onPrevDay: () => void;
  onNextDay: () => void;
}

export const SessionsAgenda: React.FC<SessionsAgendaProps> = ({
  sessions,
  selectedDate,
  onPrevDay,
  onNextDay,
}) => {
  const theme = useTheme();

  // Format time for display (HH:MM)
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Calculate duration in minutes
  const getDurationText = (start: Date, end: Date) => {
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins >= 60) {
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${diffMins}m`;
  };

  // Format date for header display
  const formatDateHeader = (date: Date) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <Card style={[styles.agendaCard, { backgroundColor: theme.colors.elevation.level1 }]}>
      <View style={styles.agendaHeader}>
        <IconButton icon="chevron-left" size={24} onPress={onPrevDay} />
        <Text variant="titleMedium" style={[styles.agendaTitle, { color: theme.colors.onSurface }]}>
          {formatDateHeader(selectedDate)}
        </Text>
        <IconButton icon="chevron-right" size={24} onPress={onNextDay} />
      </View>
      <View style={styles.agendaList}>
        {sessions.length === 0 ? (
          <View style={styles.agendaItem}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No sessions scheduled
            </Text>
          </View>
        ) : (
          sessions.map((session) => (
            <View key={session.id} style={styles.agendaItem}>
              <Icon source="calendar" size={20} color={theme.colors.primary} />
              <View style={styles.agendaItemContent}>
                <Text variant="bodyLarge" style={[styles.agendaItemTitle, { color: theme.colors.onSurface }]}>
                  {formatTime(session.start)} - {session.activityName || 'Session'} ({getDurationText(session.start, session.end)})
                </Text>
                {session.instructorName ? (
                  <Text variant="bodySmall" style={[styles.agendaItemSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                    with {session.instructorName}
                  </Text>
                ) : null}
                {session.locationName ? (
                  <Text variant="bodySmall" style={[styles.agendaItemSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                    {session.locationName}
                  </Text>
                ) : null}
              </View>
            </View>
          ))
        )}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  agendaCard: {
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 1,
  },
  agendaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  agendaTitle: {
    fontWeight: '600',
    fontSize: 16,
  },
  agendaList: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  agendaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  agendaItemContent: {
    flex: 1,
    gap: 2,
  },
  agendaItemTitle: {
    fontWeight: '500',
    fontSize: 15,
  },
  agendaItemSubtitle: {
    fontSize: 13,
  },
});
