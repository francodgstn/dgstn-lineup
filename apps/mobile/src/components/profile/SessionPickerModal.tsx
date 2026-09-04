import React from 'react';
import { Modal, StyleSheet, View, ScrollView } from 'react-native';
import { Button, IconButton, Text, useTheme, Surface, TouchableRipple } from 'react-native-paper';
import { useTranslations } from '../../i18n';

interface SessionOption {
  id: string;
  activityName: string;
  start: { toDate: () => Date } | Date;
  end: { toDate: () => Date } | Date;
}

interface SessionPickerModalProps {
  visible: boolean;
  sessions: SessionOption[];
  loading?: boolean;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

function toDate(v: SessionOption['start']): Date {
  if (typeof (v as any)?.toDate === 'function') return (v as any).toDate();
  return v as Date;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const SessionPickerModal: React.FC<SessionPickerModalProps> = ({
  visible,
  sessions,
  loading,
  onSelect,
  onClose,
}) => {
  const theme = useTheme();
  const t = useTranslations('SessionPicker');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.header}>
            <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
              {t('selectSessionTitle')}
            </Text>
            <IconButton icon="close" size={24} onPress={onClose} disabled={loading} />
          </View>

          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}
          >
            {t('multipleSessionsBody')}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {sessions.map((session) => {
              const start = toDate(session.start);
              const end = toDate(session.end);
              return (
                <Surface
                  key={session.id}
                  elevation={0}
                  style={[styles.sessionItem, { backgroundColor: theme.colors.surfaceVariant }]}
                >
                  <TouchableRipple
                    onPress={() => onSelect(session.id)}
                    disabled={loading}
                    style={{ borderRadius: 12 }}
                  >
                    <View style={styles.sessionItemContent}>
                      <View style={[styles.timeBadge, { backgroundColor: theme.colors.primaryContainer }]}>
                        <Text variant="labelMedium" style={{ color: theme.colors.onPrimaryContainer, fontWeight: '700' }}>
                          {formatTime(start)}
                        </Text>
                        <Text variant="labelSmall" style={{ color: theme.colors.onPrimaryContainer, opacity: 0.7 }}>
                          {formatTime(end)}
                        </Text>
                      </View>
                      <Text variant="titleMedium" style={{ color: theme.colors.onSurface, flex: 1 }}>
                        {session.activityName}
                      </Text>
                    </View>
                  </TouchableRipple>
                </Surface>
              );
            })}
          </ScrollView>

          <Button
            mode="outlined"
            onPress={onClose}
            disabled={loading}
            style={{ marginTop: 12 }}
          >
            {t('cancel')}
          </Button>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionItem: {
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sessionItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 14,
  },
  timeBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 56,
  },
});
