import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Surface, Text, useTheme } from 'react-native-paper';

interface TeamCardProps {
  teamName: string;
  subscriptionName: string | null;
  subscriptionRecurrence?: string | null;
  lastSeenAt?: any;
}

function formatLastSeen(value: unknown): string {
  if (!value) return '—';
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else if (typeof value === 'object' && value !== null) {
    const ref = value as any;
    if (typeof ref.toDate === 'function') date = ref.toDate();
    else if (typeof ref.seconds === 'number') date = new Date(ref.seconds * 1000);
  }
  if (!date || isNaN(date.getTime())) return '—';
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export const TeamCard: React.FC<TeamCardProps> = ({ teamName, subscriptionName, subscriptionRecurrence, lastSeenAt }) => {
  const theme = useTheme();

  return (
    <Surface
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
      elevation={2}
    >
      <View style={styles.row}>
        <View style={[styles.iconBadge, { backgroundColor: theme.dark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)' }]}>
          <Icon source="shield-outline" size={16} color="#3B82F6" />
        </View>
        <Text variant="labelSmall" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>TEAM</Text>
        <Text variant="labelMedium" style={[styles.value, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {teamName}
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

      <View style={styles.row}>
        <View style={[styles.iconBadge, { backgroundColor: theme.dark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)' }]}>
          <Icon source="tag-outline" size={16} color="#6366F1" />
        </View>
        <Text variant="labelSmall" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>SUBSCRIPTION</Text>
        <Text variant="labelMedium" style={[styles.value, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {subscriptionName
            ? subscriptionRecurrence
              ? `${subscriptionName} · ${subscriptionRecurrence}`
              : subscriptionName
            : '—'}
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.outlineVariant }]} />

      <View style={styles.row}>
        <View style={[styles.iconBadge, { backgroundColor: theme.dark ? 'rgba(20,184,166,0.12)' : 'rgba(20,184,166,0.08)' }]}>
          <Icon source="calendar-check-outline" size={16} color="#14B8A6" />
        </View>
        <Text variant="labelSmall" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>LAST SESSION</Text>
        <Text variant="labelMedium" style={[styles.value, { color: theme.colors.onSurface }]} numberOfLines={1}>
          {formatLastSeen(lastSeenAt)}
        </Text>
      </View>
    </Surface>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: -12,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 12,
    paddingHorizontal: 16,
    zIndex: -1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.8,
    fontSize: 10,
    width: 88,
  },
  value: {
    flex: 1,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginVertical: 2,
    marginLeft: 38,
  },
});
