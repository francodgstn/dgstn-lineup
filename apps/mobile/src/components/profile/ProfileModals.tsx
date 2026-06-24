import React from 'react';
import { Modal, StyleSheet, View, ScrollView } from 'react-native';
import { ActivityIndicator, Button, IconButton, Text, useTheme, Avatar, Surface, TouchableRipple } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { Contact, TeamPublicProfile } from '../../types';
import {
  getAffiliationLabel,
  getAffiliationColors,
} from '../../utils/profileUtils';

interface ProfileModalsProps {
  contact: Contact;
  teamProfile: TeamPublicProfile | null;
  showQRModal: boolean;
  onCloseQR: () => void;
  isLoadingQR: boolean;
  qrData: string | null;
  showStatusModal: boolean;
  onCloseStatus: () => void;
  showGenderInfo: boolean;
  onCloseGenderInfo: () => void;
  showContactModal: boolean;
  onCloseContactModal: () => void;
  matchedContacts: Contact[] | null;
  onSelectContact: (contactId: string) => void;
  isSwitchingContact: boolean;
  membershipTerm?: string;
}

export const ProfileModals: React.FC<ProfileModalsProps> = ({
  contact,
  teamProfile,
  showQRModal,
  onCloseQR,
  isLoadingQR,
  qrData,
  showStatusModal,
  onCloseStatus,
  showGenderInfo,
  onCloseGenderInfo,
  showContactModal,
  onCloseContactModal,
  matchedContacts,
  onSelectContact,
  isSwitchingContact,
  membershipTerm = 'Membership',
}) => {
  const theme = useTheme();

  return (
    <>
      {/* QR Code Modal */}
      <Modal
        visible={showQRModal}
        transparent
        animationType="fade"
        onRequestClose={onCloseQR}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                Check-in QR Code
              </Text>
              <IconButton icon="close" size={24} onPress={onCloseQR} />
            </View>

            <View style={styles.qrContainer}>
              {isLoadingQR ? (
                <ActivityIndicator size="large" color={theme.colors.primary} />
              ) : qrData ? (
                <QRCode
                  value={qrData}
                  size={220}
                  backgroundColor={theme.colors.surface}
                  color={theme.colors.onSurface}
                />
              ) : null}
            </View>

            <Text variant="bodyMedium" style={[styles.qrInstructions, { color: theme.colors.onSurfaceVariant }]}>
              Show this QR code to your instructor for session check-in
            </Text>

            <View style={styles.qrContactInfo}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
                {contact?.firstname} {contact?.lastname}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {teamProfile?.name || 'Member'}
              </Text>
            </View>

            <Button mode="contained" onPress={onCloseQR} style={styles.closeButton}>
              Close
            </Button>
          </View>
        </View>
      </Modal>

      {/* Affiliation Status Info Modal */}
      <Modal
        visible={showStatusModal}
        transparent
        animationType="fade"
        onRequestClose={onCloseStatus}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                {membershipTerm} Status
              </Text>
              <IconButton icon="close" size={24} onPress={onCloseStatus} />
            </View>

            <View style={[styles.currentStatusContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Your current status
              </Text>
              {(() => {
                const summary = contact.affiliation_summary;
                const colors = getAffiliationColors(summary, theme.colors);
                const label = getAffiliationLabel(summary);
                return (
                  <>
                    <View style={[styles.statusBadgeLarge, { backgroundColor: colors.bg }]}>
                      <Text variant="labelLarge" style={{ color: colors.text, fontWeight: '700' }}>
                        {label}
                      </Text>
                    </View>
                    {summary?.has_active && summary.types.length > 0 && (
                      <View style={styles.statusFlowContainer}>
                        <Text variant="titleSmall" style={{ color: theme.colors.onSurface, marginBottom: 8 }}>
                          Active affiliations
                        </Text>
                        {summary.types.map((type) => (
                          <View key={type} style={styles.statusFlowItem}>
                            <View style={[styles.statusFlowBadge, { backgroundColor: '#4CAF50' }]}>
                              <Text style={[styles.statusFlowBadgeText, { color: '#FFFFFF' }]}>✓</Text>
                            </View>
                            <View style={styles.statusFlowContent}>
                              <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
                                {type.replace(/_/g, ' ')}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                    {!summary?.has_active && (
                      <Text variant="bodyMedium" style={[styles.statusDescriptionText, { color: theme.colors.onSurface }]}>
                        No active affiliations recorded. Contact your team if you think this is a mistake.
                      </Text>
                    )}
                  </>
                );
              })()}
            </View>

            <Button mode="contained" onPress={onCloseStatus} style={styles.closeButton}>
              Close
            </Button>
          </View>
        </View>
      </Modal>

      {/* Gender Info Modal */}
      <Modal
        visible={showGenderInfo}
        transparent
        animationType="fade"
        onRequestClose={onCloseGenderInfo}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                Gender
              </Text>
              <IconButton icon="close" size={24} onPress={onCloseGenderInfo} />
            </View>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginBottom: 20 }}>
              This field is required for registration to kickboxing federations, tournaments, and other events. It does not define or classify gender identity within our community.
            </Text>
            <Button mode="contained" onPress={onCloseGenderInfo} style={styles.closeButton}>
              Close
            </Button>
          </View>
        </View>
      </Modal>

      {/* Contact Selection Modal */}
      <Modal
        visible={showContactModal}
        transparent
        animationType="slide"
        onRequestClose={onCloseContactModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                Switch Account
              </Text>
              <IconButton icon="close" size={24} onPress={onCloseContactModal} disabled={isSwitchingContact} />
            </View>

            {isSwitchingContact ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={{ marginTop: 16, color: theme.colors.onSurfaceVariant }}>Switching account...</Text>
              </View>
            ) : (
              <ScrollView
                style={{ width: '100%' }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 12 }}
              >
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16, textAlign: 'center' }}>
                  Select the account you want to switch to:
                </Text>

                {matchedContacts?.map((c) => {
                  const isCurrent = c.id === contact.id;
                  return (
                    <Surface
                      key={c.id}
                      elevation={isCurrent ? 2 : 0}
                      style={[
                        styles.contactItem,
                        { backgroundColor: isCurrent ? theme.colors.primaryContainer : theme.colors.surfaceVariant }
                      ]}
                    >
                      <TouchableRipple
                        onPress={() => onSelectContact(c.id)}
                        disabled={isCurrent}
                        style={{ borderRadius: 12 }}
                      >
                        <View style={styles.contactItemContent}>
                          {c.avatar_url ? (
                            <Avatar.Image
                              size={48}
                              source={{ uri: c.avatar_url }}
                            />
                          ) : (
                            <Avatar.Text
                              label={`${c.firstname?.[0] || ''}${c.lastname?.[0] || ''}`.toUpperCase()}
                              size={48}
                              style={{ backgroundColor: isCurrent ? theme.colors.primary : theme.colors.surfaceVariant }}
                              color={isCurrent ? theme.colors.onPrimary : theme.colors.onSurfaceVariant}
                            />
                          )}
                          <View style={{ flex: 1, marginLeft: 16 }}>
                            <Text variant="titleMedium" style={{ color: isCurrent ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant, fontWeight: '700' }}>
                              {c.firstname} {c.lastname}
                            </Text>
                            <Text variant="bodySmall" style={{ color: isCurrent ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant, opacity: 0.8 }}>
                              {c.teamName || 'Member'}
                            </Text>
                          </View>
                          {isCurrent && (
                            <IconButton icon="check-circle" iconColor={theme.colors.primary} size={24} />
                          )}
                        </View>
                      </TouchableRipple>
                    </Surface>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  modalHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  qrContainer: {
    padding: 20,
    borderRadius: 16,
    marginVertical: 16,
    minHeight: 260,
    minWidth: 260,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrInstructions: {
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  qrContactInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  closeButton: {
    width: '100%',
  },
  currentStatusContainer: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    width: '100%',
  },
  contactItem: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  contactItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  statusBadgeLarge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  statusDescriptionText: {
    textAlign: 'center',
  },
  statusFlowContainer: {
    marginBottom: 16,
    width: '100%',
  },
  statusFlowItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  statusFlowBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusFlowBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusFlowContent: {
    flex: 1,
    gap: 2,
  },
});
