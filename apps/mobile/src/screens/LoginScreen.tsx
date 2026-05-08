import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Alert, View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TextInput as RNTextInput } from 'react-native';
import {
  Button,
  Card,
  Checkbox,
  HelperText,
  Text,
  TextInput,
  TouchableRipple,
  useTheme
} from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { FirestoreService } from '../services/firestore';
import { TeamPublicProfile } from '../types';
import { RootStackParamList } from '../navigation/AppNavigator';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { GradientBackground } from '../components/GradientBackground';

type LoginScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;
type LoginStep = 'email' | 'code' | 'team-selection' | 'contact-selection';

export const LoginScreen: React.FC = () => {
  const theme = useTheme();
  const [step, setStep] = useState<LoginStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [teams, setTeams] = useState<TeamPublicProfile[]>([]);
  const {
    sendCode,
    verifyCode,
    isLoading,
    matchedContacts,
    teamSummaries,
    selectContact,
    isAuthenticated
  } = useAuth();
  const navigation = useNavigation<LoginScreenNavigationProp>();

  // Navigate to Profile screen when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Profile' }],
      });
    }
  }, [isAuthenticated, navigation]);

  useEffect(() => {
    // Load active teams on mount
    const loadTeams = async () => {
      const activeTeams = await FirestoreService.getActiveTeams();
      setTeams(activeTeams);
    };
    loadTeams();

    // If we have matched contacts but no authenticated contact, jump to selection
    if (matchedContacts && matchedContacts.length > 0 && !isAuthenticated) {
      if (multipleTeamsAvailable) {
        setStep('team-selection');
      } else {
        if (matchedContacts[0].teamId) {
          setSelectedTeamId(matchedContacts[0].teamId);
        }
        setStep('contact-selection');
      }
    }
  }, []);

  useEffect(() => {
    if (step !== 'code') {
      return;
    }

    if (!matchedContacts || matchedContacts.length === 0) {
      return;
    }

    const uniqueTeamIds = Array.from(
      new Set(
        matchedContacts
          .map((contact) => contact.teamId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    if (uniqueTeamIds.length > 1) {
      setSelectedTeamId('');
      setStep('team-selection');
      return;
    }

    if (uniqueTeamIds.length === 1) {
      setSelectedTeamId(uniqueTeamIds[0]);
    }
    setStep('contact-selection');
  }, [matchedContacts, step]);

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();

    teams.forEach((team) => {
      if (team.id) {
        map.set(team.id, team.name);
      }
    });

    teamSummaries?.forEach((summary) => {
      if (summary.id) {
        map.set(summary.id, summary.name);
      }
    });

    matchedContacts?.forEach((contact) => {
      if (contact.teamId && contact.teamName) {
        map.set(contact.teamId, contact.teamName);
      }
    });

    return map;
  }, [teams, teamSummaries, matchedContacts]);

  const resolveTeamName = (teamId?: string | null) => {
    if (!teamId) {
      return 'Team';
    }
    return teamNameMap.get(teamId) || 'Team';
  };

  const teamOptions = useMemo(() => {
    const counts = new Map<string, number>();

    matchedContacts?.forEach((contact) => {
      const id = contact.teamId || '';
      if (!id) {
        return;
      }
      counts.set(id, (counts.get(id) || 0) + 1);
    });

    teamSummaries?.forEach((summary) => {
      if (summary.id && !counts.has(summary.id)) {
        counts.set(summary.id, 0);
      }
    });

    if (counts.size === 0 && teams.length > 0) {
      teams.forEach((team) => {
        if (team.id) {
          counts.set(team.id, counts.get(team.id) || 0);
        }
      });
    }

    return Array.from(counts.entries()).map(([id, count]) => ({
      id,
      name: teamNameMap.get(id) || 'Team',
      contactCount: count
    }));
  }, [matchedContacts, teamSummaries, teams, teamNameMap]);

  const filteredContacts = useMemo(() => {
    if (!matchedContacts) {
      return [];
    }

    if (selectedTeamId) {
      return matchedContacts.filter((contact) => contact.teamId === selectedTeamId);
    }

    return matchedContacts;
  }, [matchedContacts, selectedTeamId]);

  const multipleTeamsAvailable = useMemo(() => {
    if (!matchedContacts) {
      return false;
    }
    const uniqueTeamIds = new Set(
      matchedContacts
        .map((contact) => contact.teamId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
    return uniqueTeamIds.size > 1;
  }, [matchedContacts]);

  const codeInputRef = useRef<RNTextInput>(null);
  const autoSubmittedRef = useRef(false);

  const handleVerifyCode = useCallback(async () => {
    if (!code.trim() || code.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit code');
      return;
    }

    const result = await verifyCode(code.trim(), stayLoggedIn);
    if (result.success) {
      // AuthContext will automatically set contact and isAuthenticated
    } else {
      Alert.alert('Error', result.error || 'Invalid code');
      setCode('');
      codeInputRef.current?.focus();
    }
  }, [code, verifyCode, stayLoggedIn]);

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (code.length === 6 && !autoSubmittedRef.current && !isLoading) {
      autoSubmittedRef.current = true;
      handleVerifyCode();
    }
    if (code.length < 6) {
      autoSubmittedRef.current = false;
    }
  }, [code, isLoading, handleVerifyCode]);

  const handleSendCode = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    const result = await sendCode(email.trim());
    if (result.success) {
      setStep('code');
      setCode('');
      setSelectedTeamId('');
    } else {
      Alert.alert('Error', result.error || 'Failed to send verification code');
    }
  };

  const handleSelectContact = async (contactId: string) => {
    const result = await selectContact(contactId, stayLoggedIn);
    if (!result.success) {
      Alert.alert('Error', result.error || 'Failed to select contact');
    }
  };

  const handleTeamSelection = (teamId: string) => {
    setSelectedTeamId(teamId);
    setStep('contact-selection');
  };

  const handleBackToTeams = () => {
    setSelectedTeamId('');
    setStep('team-selection');
  };

  const renderHeader = (title: string, subtitle: string) => (
    <View style={styles.header}>
      <Text variant="headlineMedium" style={styles.headerTitle}>{title}</Text>
      <Text variant="bodyMedium" style={[styles.headerSubtitle, { color: theme.colors.onSurfaceVariant }]}>{subtitle}</Text>
    </View>
  );

  const renderStayLoggedIn = () => (
    <TouchableRipple
      onPress={() => setStayLoggedIn(!stayLoggedIn)}
      style={styles.checkboxContainer}
      disabled={isLoading}
    >
      <View style={styles.checkboxRow}>
        <Checkbox.Android
          status={stayLoggedIn ? 'checked' : 'unchecked'}
          onPress={() => setStayLoggedIn(!stayLoggedIn)}
          disabled={isLoading}
          color={theme.colors.primary}
        />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
          Stay logged in
        </Text>
      </View>
    </TouchableRipple>
  );

  if (step === 'email') {
    return (
      <GradientBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.centeredContent} keyboardShouldPersistTaps="handled">
          {renderHeader('HMD Student', 'Sign in with the email registered by your team')}

          <TextInput
            mode="outlined"
            label="Email Address"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            disabled={isLoading}
            style={styles.paperInput}
          />

          <Button
            mode="contained"
            onPress={handleSendCode}
            disabled={isLoading}
            style={styles.primaryButton}
            loading={isLoading}
          >
            Send Code
          </Button>

          <Text variant="bodySmall" style={[styles.infoText, { color: theme.colors.onSurfaceVariant }]}>
            Your email must be registered by your team manager or instructor before you can sign in. If you don't have access, please contact your master or instructor.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
      </GradientBackground>
    );
  }

  if (step === 'code') {
    const digits = code.split('');
    return (
      <GradientBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.centeredContent} keyboardShouldPersistTaps="handled">
          {renderHeader('Verify Code', `Enter the 6-digit code sent to ${email}`)}

          <View
            style={styles.pinContainer}
            onTouchEnd={() => codeInputRef.current?.focus()}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.pinCell,
                  {
                    borderColor: i === digits.length
                      ? theme.colors.primary
                      : digits[i]
                        ? theme.colors.outline
                        : theme.colors.outlineVariant,
                    backgroundColor: theme.colors.surface
                  }
                ]}
              >
                <Text variant="headlineMedium" style={styles.pinDigit}>
                  {digits[i] || ''}
                </Text>
              </View>
            ))}
            <RNTextInput
              ref={codeInputRef}
              value={code}
              onChangeText={(text) => setCode(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              editable={!isLoading}
              style={styles.hiddenInput}
              caretHidden
            />
          </View>

          {renderStayLoggedIn()}

          {isLoading ? (
            <Button
              mode="contained"
              disabled
              style={styles.primaryButton}
              loading
            >
              Verifying
            </Button>
          ) : (
            <Button
              mode="contained"
              onPress={handleVerifyCode}
              disabled={code.length !== 6}
              style={styles.primaryButton}
            >
              Verify Code
            </Button>
          )}

          <Button
            mode="text"
            onPress={() => { setStep('email'); setCode(''); }}
            disabled={isLoading}
          >
            Back to email
          </Button>

          <Text variant="bodySmall" style={[styles.infoText, { color: theme.colors.onSurfaceVariant }]}>
            Code expires in 10 minutes
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
      </GradientBackground>
    );
  }

  if (step === 'team-selection') {
    return (
      <GradientBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.content}>
          {renderHeader(
            'Choose Team',
            'Select the team associated with your email address.'
          )}

          {teamOptions.length > 0 ? (
            teamOptions.map((team) => (
              <Card
                key={team.id}
                style={styles.contactCard}
                onPress={() => handleTeamSelection(team.id)}
                mode="contained"
              >
                <Card.Content>
                  <Text variant="titleLarge">{team.name}</Text>
                  <Text variant="bodyMedium" style={[styles.teamMeta, { color: theme.colors.onSurfaceVariant }]}>
                    {team.contactCount > 0
                      ? team.contactCount === 1
                        ? '1 contact available'
                        : `${team.contactCount} contacts available`
                      : 'No saved contacts yet'}
                  </Text>
                </Card.Content>
              </Card>
            ))
          ) : (
            <HelperText type="info" visible>
              No linked teams found for this email. Please contact support if you
              believe this is an error.
            </HelperText>
          )}

          <Button
            mode="text"
            onPress={() => setStep('code')}
            disabled={isLoading}
          >
            Back to code
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
      </GradientBackground>
    );
  }

  if (step === 'contact-selection' && matchedContacts) {
    return (
      <GradientBackground>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.container}
        >
          <ScrollView contentContainerStyle={styles.content}>
            {renderHeader(
              'Select Contact',
              multipleTeamsAvailable && selectedTeamId
                ? `Contacts for ${resolveTeamName(selectedTeamId)}`
                : 'Multiple contacts found with this email. Please select yours:'
            )}

            {multipleTeamsAvailable && (
              <Button
                mode="text"
                onPress={handleBackToTeams}
                style={styles.inlineButton}
                disabled={isLoading}
              >
                Change team
              </Button>
            )}

            {filteredContacts.length > 0 ? (
              filteredContacts.map((contact) => {
                const phoneDisplay = contact.phone?.trim();

                return (
                  <Card
                    key={contact.id}
                    style={[styles.contactCard, isLoading && { opacity: 0.6 }]}
                    onPress={() => handleSelectContact(contact.id)}
                    mode="contained"
                    disabled={isLoading}
                  >
                    <Card.Content>
                      <Text variant="titleLarge">
                        {`${contact.firstname || ''} ${contact.lastname || ''}`.trim()}
                      </Text>
                      {phoneDisplay ? (
                        <Text variant="bodyMedium" style={[styles.contactPhone, { color: theme.colors.onSurfaceVariant }]}>{phoneDisplay}</Text>
                      ) : null}
                      <Text variant="bodySmall" style={[styles.teamMeta, { color: theme.colors.onSurfaceVariant }]}>
                        {resolveTeamName(contact.teamId)}
                      </Text>
                    </Card.Content>
                  </Card>
                );
              })
            ) : (
              <HelperText type="info" visible>
                No contacts available for this team. Go back and choose a different team or
                try another email.
              </HelperText>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
        <LoadingOverlay visible={isLoading} message="Signing in..." />
      </GradientBackground>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 32,
  },
  centeredContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 80,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontWeight: 'bold',
  },
  headerSubtitle: {
    textAlign: 'center',
    marginTop: 8,
  },
  paperInput: {
    marginBottom: 16,
  },
  primaryButton: {
    marginTop: 8,
  },
  card: {
    marginBottom: 16,
  },
  contactCard: {
    marginBottom: 12,
  },
  contactPhone: {
    marginTop: 4,
  },
  teamMeta: {
    marginTop: 6,
  },
  inlineButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingHorizontal: 0,
  },
  infoText: {
    marginTop: 16,
    textAlign: 'center',
    lineHeight: 18,
  },
  pinContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 16,
    position: 'relative',
  },
  pinCell: {
    width: 44,
    height: 56,
    borderWidth: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDigit: {
    fontWeight: '600',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  checkboxContainer: {
    marginVertical: 12,
    borderRadius: 8,
    alignSelf: 'center',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
    paddingLeft: 4,
  },
});
