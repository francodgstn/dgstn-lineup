import React, { useState } from 'react';
import { Modal, StyleSheet, View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Button, IconButton, Text, TextInput, useTheme, Surface, ActivityIndicator, Divider, TouchableRipple, Icon } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Contact } from '../../types';
import { FirestoreService } from '../../services/firestore';
import { useTranslations } from '../../i18n';

interface ProfileUpdateModalProps {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
  onSuccess: () => void;
}

const parseToDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'object' && value !== null) {
    const ref: any = value;
    if (typeof ref.toDate === 'function') return ref.toDate();
    if (typeof ref.seconds === 'number') return new Date(ref.seconds * 1000);
  }
  return null;
};

export const ProfileUpdateModal: React.FC<ProfileUpdateModalProps> = ({
  visible,
  onClose,
  contact,
  onSuccess,
}) => {
  const theme = useTheme();
  const t = useTranslations('ProfileUpdate');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBirthdatePicker, setShowBirthdatePicker] = useState(false);

  // Form State
  const [birthdate, setBirthdate] = useState<Date | null>(parseToDate(contact.birthdate));
  const [formData, setFormData] = useState({
    firstname: contact.firstname || '',
    lastname: contact.lastname || '',
    email: contact.email || '',
    phone: contact.phone || '',
    birthplace: contact.birthplace || '',
    gender: contact.gender || '',
    route: contact.address?.route || '',
    street_number: contact.address?.street_number || '',
    postal_code: contact.address?.postal_code || '',
    locality: contact.address?.locality || '',
    emergencyContactName: contact.emergency_contacts?.[0]?.name || '',
    emergencyContactPhone: contact.emergency_contacts?.[0]?.phone || '',
    weight: contact.weight?.toString() || '',
    note: '',
  });

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.firstname.trim() || !formData.lastname.trim()) {
      setError(t('firstLastNameRequired'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Prepare the update request payload. This is `requestContactUpdate`'s
      // OWN wire contract (packages/functions/src/contacts/requestContactUpdate.ts),
      // NOT `Partial<Contact>` — it predates the shared Contact type's field
      // names (`residence`/`emergencyContact`, singular) and is unrelated to
      // how the contact document itself is shaped once approved.
      const contactDetails = {
        firstname: formData.firstname.trim(),
        lastname: formData.lastname.trim(),
        phone: formData.phone.trim(),
        birthdate: birthdate ? birthdate.toISOString().split('T')[0] : null,
        birthplace: formData.birthplace.trim(),
        gender: formData.gender,
        residence: {
          route: formData.route.trim(),
          street_number: formData.street_number.trim(),
          postal_code: formData.postal_code.trim(),
          locality: formData.locality.trim(),
        },
        emergencyContact: {
          name: formData.emergencyContactName.trim(),
          phone: formData.emergencyContactPhone.trim(),
        },
        weight: formData.weight ? parseFloat(formData.weight) : undefined,
      };

      // 2. Submit request via cloud function — our contact session identifies us.
      await FirestoreService.requestContactUpdate({
        contactDetails,
        note: formData.note.trim(),
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Submission error:', err);
      setError(err.message || t('submitFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <Surface style={[styles.header, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <View style={styles.headerContent}>
            <Text variant="titleLarge">{t('updateProfileTitle')}</Text>
            <IconButton icon="close" onPress={onClose} disabled={loading} />
          </View>
        </Surface>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text variant="bodyMedium" style={[styles.introText, { color: theme.colors.onSurfaceVariant }]}>
            {t('introText')}
          </Text>

          {error && (
            <Surface style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer }]}>
              <Text style={{ color: theme.colors.onErrorContainer }}>{error}</Text>
            </Surface>
          )}

          <Section title={t('sectionPersonalInfo')}>
            <TextInput
              label={t('firstNameLabel')}
              value={formData.firstname}
              onChangeText={val => handleChange('firstname', val)}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label={t('lastNameLabel')}
              value={formData.lastname}
              onChangeText={val => handleChange('lastname', val)}
              mode="outlined"
              style={styles.input}
            />
            <View style={styles.input}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>
                {t('birthdateLabel')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableRipple
                  onPress={() => setShowBirthdatePicker(true)}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: theme.colors.outline,
                    borderRadius: 4,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                  }}
                >
                  <Text variant="bodyMedium" style={{ color: birthdate ? theme.colors.onSurface : theme.colors.onSurfaceVariant }}>
                    {birthdate
                      ? birthdate.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
                      : t('selectDob')}
                  </Text>
                </TouchableRipple>
                {birthdate && (
                  <TouchableRipple onPress={() => setBirthdate(null)} borderless style={{ borderRadius: 16 }}>
                    <Icon source="close-circle-outline" size={22} color={theme.colors.onSurfaceVariant} />
                  </TouchableRipple>
                )}
              </View>
              {showBirthdatePicker && (
                <DateTimePicker
                  value={birthdate ?? new Date(2000, 0, 1)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  maximumDate={new Date()}
                  onChange={(_, date) => {
                    if (Platform.OS === 'android') setShowBirthdatePicker(false);
                    if (date) setBirthdate(date);
                  }}
                />
              )}
              {Platform.OS === 'ios' && showBirthdatePicker && (
                <Button compact onPress={() => setShowBirthdatePicker(false)} style={{ alignSelf: 'flex-end' }}>
                  {t('done')}
                </Button>
              )}
            </View>
            <TextInput
              label={t('birthplaceLabel')}
              value={formData.birthplace}
              onChangeText={val => handleChange('birthplace', val)}
              mode="outlined"
              style={styles.input}
            />
            <View>
              <View style={styles.genderInputRow}>
                <TextInput
                  label={t('genderMFLabel')}
                  value={formData.gender}
                  onChangeText={val => handleChange('gender', val)}
                  mode="outlined"
                  style={[styles.input, { flex: 1 }]}
                />
                <IconButton
                  icon="information-outline"
                  size={20}
                  onPress={() => setError(t('genderInfoBody'))}
                />
              </View>
              <Text variant="bodySmall" style={[styles.helperText, { color: theme.colors.onSurfaceVariant }]}>
                {t('genderHelperText')}
              </Text>
            </View>
            <TextInput
              label={t('weightKgLabel')}
              value={formData.weight}
              onChangeText={val => handleChange('weight', val)}
              mode="outlined"
              style={styles.input}
              keyboardType="numeric"
            />
          </Section>

          <Section title={t('sectionContactDetails')}>
            <TextInput
              label={t('emailLabel')}
              value={formData.email}
              disabled
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label={t('phoneNumberLabel')}
              value={formData.phone}
              onChangeText={val => handleChange('phone', val)}
              mode="outlined"
              style={styles.input}
              keyboardType="phone-pad"
            />
          </Section>

          <Section title={t('sectionAddress')}>
            <View style={styles.row}>
              <TextInput
                label={t('streetLabel')}
                value={formData.route}
                onChangeText={val => handleChange('route', val)}
                mode="outlined"
                style={[styles.input, { flex: 2, marginRight: 8 }]}
              />
              <TextInput
                label={t('noLabel')}
                value={formData.street_number}
                onChangeText={val => handleChange('street_number', val)}
                mode="outlined"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
            <View style={styles.row}>
              <TextInput
                label={t('zipLabel')}
                value={formData.postal_code}
                onChangeText={val => handleChange('postal_code', val)}
                mode="outlined"
                style={[styles.input, { flex: 1, marginRight: 8 }]}
                keyboardType="numeric"
              />
              <TextInput
                label={t('cityLabel')}
                value={formData.locality}
                onChangeText={val => handleChange('locality', val)}
                mode="outlined"
                style={[styles.input, { flex: 2 }]}
              />
            </View>
          </Section>

          <Section title={t('sectionEmergencyContact')}>
            <TextInput
              label={t('contactNameLabel')}
              value={formData.emergencyContactName}
              onChangeText={val => handleChange('emergencyContactName', val)}
              mode="outlined"
              style={styles.input}
            />
            <TextInput
              label={t('contactPhoneLabel')}
              value={formData.emergencyContactPhone}
              onChangeText={val => handleChange('emergencyContactPhone', val)}
              mode="outlined"
              style={styles.input}
              keyboardType="phone-pad"
            />
          </Section>

          <Section title={t('sectionAdditionalNotes')}>
            <TextInput
              label={t('notesForAdminLabel')}
              value={formData.note}
              onChangeText={val => handleChange('note', val)}
              mode="outlined"
              multiline
              numberOfLines={3}
              style={styles.input}
            />
          </Section>

          <View style={styles.buttonContainer}>
            <Button
              mode="contained"
              onPress={handleSubmit}
              loading={loading}
              disabled={loading}
              style={styles.submitButton}
            >
              {t('submitUpdateRequest')}
            </Button>
            <Button
              mode="text"
              onPress={onClose}
              disabled={loading}
              style={styles.cancelButton}
            >
              {t('cancel')}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="labelLarge" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
        {title.toUpperCase()}
      </Text>
      {children}
      <Divider style={styles.divider} />
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === 'ios' ? 40 : 10,
    paddingHorizontal: 8,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 56,
    paddingLeft: 16,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  introText: {
    marginBottom: 20,
    lineHeight: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  input: {
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  genderInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  helperText: {
    marginTop: -8,
    marginBottom: 12,
    fontSize: 11,
    paddingHorizontal: 4,
  },
  divider: {
    marginTop: 12,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  buttonContainer: {
    marginTop: 12,
    gap: 8,
  },
  submitButton: {
    paddingVertical: 6,
    borderRadius: 12,
  },
  cancelButton: {
    borderRadius: 12,
  },
});
