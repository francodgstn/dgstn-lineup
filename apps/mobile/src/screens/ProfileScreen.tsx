import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  UIManager,
  View,
  StatusBar,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import {
  Button,
  IconButton,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
  Avatar,
  Icon,
  Snackbar,
} from 'react-native-paper';
import { useAuth } from '../contexts/AuthContext';
import { FirestoreService } from '../services/firestore';
import { Contact, SessionPublicProfile, TeamPublicProfile, Leaderboard, SessionWithStatus, ContactAlert, GamificationSettings, CoachSlotWithStatus } from '../types';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { formatDateValue, formatResidence, formatGender } from '../utils/profileUtils';

// Redesigned Components
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { MembershipCard } from '../components/profile/MembershipCard';
import { GamificationCard } from '../components/profile/GamificationCard';
import { TrainingActivity } from '../components/TrainingActivity';
import { ProfileModals } from '../components/profile/ProfileModals';
import { ProfileUpdateModal } from '../components/profile/ProfileUpdateModal';
import { SessionAgendaCard } from '../components/profile/SessionAgendaCard';
import { CoachSlotsCarousel } from '../components/profile/CoachSlotsCarousel';
import { CoachingDashboardCard } from '../components/profile/CoachingDashboardCard';
import { AlertsCard } from '../components/AlertsCard';
import { BadgesCard } from '../components/profile/BadgesCard';
import { SocialActionsCard } from '../components/profile/SocialActionsCard';
import { TeamCard } from '../components/profile/TeamCard';
import { TeamQrScannerModal } from '../components/profile/TeamQrScannerModal';
import { SessionPickerModal } from '../components/profile/SessionPickerModal';
import { GoalsSection } from '../components/profile/GoalsSection';
import { PerformanceProfileSection } from '../components/profile/PerformanceProfileSection';

type TabType = 'DASH' | 'FEED' | 'TRAIN' | 'TEAM' | 'SELF';

interface CheckInFeedback {
  type: 'success' | 'error' | 'info';
  sessionName?: string;
  sessionStart?: number; // ms epoch
  message?: string;
}

const CheckInFeedbackCard: React.FC<{ feedback: CheckInFeedback; onDismiss: () => void }> = ({ feedback, onDismiss }) => {
  const theme = useTheme();

  const isSuccess = feedback.type === 'success';
  const isError = feedback.type === 'error';

  const bgColor = isSuccess
    ? theme.dark ? 'rgba(34,197,94,0.15)' : '#F0FDF4'
    : isError
    ? theme.dark ? 'rgba(239,68,68,0.15)' : '#FEF2F2'
    : theme.dark ? 'rgba(100,116,139,0.15)' : '#F1F5F9';

  const accentColor = isSuccess ? '#22C55E' : isError ? '#EF4444' : '#64748B';
  const iconName = isSuccess ? 'check-circle' : isError ? 'alert-circle' : 'information';

  let title = '';
  let subtitle = '';

  if (isSuccess && feedback.sessionName) {
    title = 'Checked in!';
    const parts: string[] = [feedback.sessionName];
    if (feedback.sessionStart) {
      const d = new Date(feedback.sessionStart);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const today = new Date();
      const isToday = d.toDateString() === today.toDateString();
      parts.push(isToday ? `Today at ${time}` : `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`);
    }
    subtitle = parts.join(' · ');
  } else {
    title = isError ? 'Check-in failed' : 'Check-in';
    subtitle = feedback.message || '';
  }

  return (
    <Surface
      style={[
        { borderRadius: 16, overflow: 'hidden', backgroundColor: bgColor },
      ]}
      elevation={0}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
        <Icon source={iconName} size={28} color={accentColor} />
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" style={{ color: accentColor, fontWeight: '800' }}>{title}</Text>
          {subtitle ? (
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        <IconButton icon="close" size={18} iconColor={theme.colors.onSurfaceVariant} onPress={onDismiss} style={{ margin: 0 }} />
      </View>
    </Surface>
  );
};

export const ProfileScreen: React.FC = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { contact, logout, refreshContact, email, showContactSelection, selectContact, matchedContacts } = useAuth();
  const scrollRef = useRef<any>(null);

  const [teamProfile, setTeamProfile] = useState<TeamPublicProfile | null>(null);
  const [membershipTerm, setMembershipTerm] = useState<string>('Membership');
  const [subscriptionTypeName, setSubscriptionTypeName] = useState<string | null>(null);
  const [membershipCollapsed, setMembershipCollapsed] = useState(true);
  const [teamCardCollapsed, setTeamCardCollapsed] = useState(true);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [lbSort, setLbSort] = useState<'points' | 'streak' | 'best_streak'>('points');
  const [agendaSessions, setAgendaSessions] = useState<SessionWithStatus[]>([]);
  const [coachSlots, setCoachSlots] = useState<CoachSlotWithStatus[]>([]);
  const [coachingCollapsed, setCoachingCollapsed] = useState(false);
  const [coachCarouselOpen, setCoachCarouselOpen] = useState(false);
  const [alerts, setAlerts] = useState<ContactAlert[]>([]);
  const [gamificationSettings, setGamificationSettings] = useState<GamificationSettings | null>(null);
  const [rewardedCount, setRewardedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTab, setCurrentTab] = useState<TabType>('DASH');
  // Modals state
  const [showQRModal, setShowQRModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showGenderInfo, setShowGenderInfo] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showUpdateSuccess, setShowUpdateSuccess] = useState(false);
  const [isSwitchingContact, setIsSwitchingContact] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [isLoadingQR, setIsLoadingQR] = useState(false);

  // Self check-in state
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [scanSessions, setScanSessions] = useState<Array<{ id: string; activityName: string; start: any; end: any }>>([]);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [pendingTeamSlug, setPendingTeamSlug] = useState<string | null>(null);
  const [checkInFeedback, setCheckInFeedback] = useState<CheckInFeedback | null>(null);

  // Weight edit state
  const [isEditingWeight, setIsEditingWeight] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [isSavingWeight, setIsSavingWeight] = useState(false);

  useEffect(() => {
    loadData();
  }, [contact?.id]);

  const loadData = async () => {
    if (!contact) return;
    setIsLoading(true);
    try {
      let loadedProfile = null;
      if (contact.teamId) {
        loadedProfile = await FirestoreService.getTeamPublicProfile(contact.teamId);
        setTeamProfile(loadedProfile);
        const term = await FirestoreService.getOrgMembershipTerm(contact.teamId);
        setMembershipTerm(term);
        if (contact.subscription_type_id) {
          const name = await FirestoreService.getSubscriptionTypeName(contact.teamId, contact.subscription_type_id);
          setSubscriptionTypeName(name);
        }
      }
      if (contact.teamId) {
        const lb = await FirestoreService.getTeamLeaderboard(contact.teamId);
        setLeaderboard(lb);

        // Fetch agenda sessions (±7 days)
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 7);
        const agenda = await FirestoreService.getSessionsWithParticipation(
          contact.id,
          contact.teamId,
          startDate,
          endDate
        );
        setAgendaSessions(agenda);
      }

      const contactAlerts = await FirestoreService.getContactAlerts(contact.id);
      setAlerts(contactAlerts);

      if (contact.teamId) {
        const settings = await FirestoreService.getTeamGamificationSettings(contact.teamId);
        setGamificationSettings(settings);
      }

      if (loadedProfile?.referralEnabled) {
        const stats = await FirestoreService.getMyReferralStats();
        setRewardedCount(stats.rewarded_count);
      }

      if (contact.teamId && loadedProfile?.coachingEnabled) {
        const slots = await FirestoreService.getUpcomingCoachSlots(contact.teamId, contact.id);
        setCoachSlots(slots);
      } else {
        setCoachSlots([]);
      }
    } catch (error) {
      console.error('Error loading profile data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshContact();
    await loadData();
    setIsRefreshing(false);
  };

  const initials = useMemo(() => {
    if (!contact) return '';
    return `${contact.firstname?.[0] || ''}${contact.lastname?.[0] || ''}`.toUpperCase();
  }, [contact]);

  const myLeaderboardRank = useMemo(() => {
    if (!leaderboard || !contact?.id) return undefined;
    const sorted = [...leaderboard.entries].sort((a, b) => b.score - a.score || a.lastname.localeCompare(b.lastname));
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].score < sorted[i - 1].score) rank++;
      if (sorted[i].contact_id === contact.id) return rank;
    }
    return undefined;
  }, [leaderboard, contact?.id]);

  const sortedLeaderboardEntries = useMemo(() => {
    if (!leaderboard) return [];
    return [...leaderboard.entries].sort((a, b) => {
      if (lbSort === 'streak') return (b.streak || 0) - (a.streak || 0) || a.lastname.localeCompare(b.lastname);
      if (lbSort === 'best_streak') return (b.max_streak || 0) - (a.max_streak || 0) || a.lastname.localeCompare(b.lastname);
      return b.score - a.score || a.lastname.localeCompare(b.lastname);
    });
  }, [leaderboard, lbSort]);

  const handleUpdateWeight = async () => {
    if (!contact?.id) return;
    const parsed = parseFloat(weightInput.replace(',', '.'));
    if (isNaN(parsed) || parsed < 0) {
      Alert.alert('Invalid Weight', 'Please enter a valid weight in kg.');
      return;
    }
    setIsSavingWeight(true);
    try {
      await FirestoreService.updateContactWeight(contact.id, parsed);
      await refreshContact();
      setIsEditingWeight(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to update weight');
    } finally {
      setIsSavingWeight(false);
    }
  };

  const showFeedback = (fb: CheckInFeedback) => {
    setCheckInFeedback(fb);
    setTimeout(() => setCheckInFeedback(null), 5000);
  };

  const refreshAgenda = useCallback(async () => {
    if (!contact?.teamId || !contact?.id) return;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);
    const agenda = await FirestoreService.getSessionsWithParticipation(contact.id, contact.teamId, startDate, endDate);
    setAgendaSessions(agenda);
  }, [contact?.id, contact?.teamId]);

  const handleTeamQrScanned = useCallback(async (slug: string) => {
    setShowScannerModal(false);
    setCheckInLoading(true);
    setPendingTeamSlug(slug);
    try {
      const result = await FirestoreService.selfCheckIn({ teamSlug: slug });
      if (result.status === 'no_sessions') {
        showFeedback({ type: 'info', message: 'No active sessions at this time.' });
      } else if (result.status === 'session_required') {
        setScanSessions(result.sessions);
        setShowSessionPicker(true);
      } else if (result.status === 'checked_in') {
        showFeedback({ type: 'success', sessionName: result.sessionName, sessionStart: result.sessionStart });
        refreshAgenda();
      }
    } catch (err: any) {
      showFeedback({ type: 'error', message: err?.message || 'Check-in failed. Please try again.' });
    } finally {
      setCheckInLoading(false);
    }
  }, [refreshAgenda]);

  const handleSessionPicked = useCallback(async (sessionId: string) => {
    if (!pendingTeamSlug) return;
    setShowSessionPicker(false);
    setCheckInLoading(true);
    try {
      const result = await FirestoreService.selfCheckIn({ teamSlug: pendingTeamSlug, sessionId });
      if (result.status === 'checked_in') {
        showFeedback({ type: 'success', sessionName: result.sessionName, sessionStart: result.sessionStart });
        refreshAgenda();
      } else {
        showFeedback({ type: 'error', message: 'Check-in failed. Please try again.' });
      }
    } catch (err: any) {
      showFeedback({ type: 'error', message: err?.message || 'Check-in failed. Please try again.' });
    } finally {
      setCheckInLoading(false);
      setPendingTeamSlug(null);
    }
  }, [pendingTeamSlug, refreshAgenda]);

  const handleShowQR = useCallback(async () => {
    setIsLoadingQR(true);
    setShowQRModal(true);
    try {
      const result = await FirestoreService.getMembershipQR();
      if (result?.success && result.qrData) {
        setQrData(result.qrData);
      } else {
        Alert.alert('Error', 'Failed to generate QR code.');
        setShowQRModal(false);
      }
    } catch (error) {
      setShowQRModal(false);
    } finally {
      setIsLoadingQR(false);
    }
  }, []);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          logout().catch((err) => {
            console.error('Logout error:', err);
          });
        },
      },
    ]);
  };

  if (!contact) return <LoadingOverlay visible message="Loading profile..." />;


  const handleShowContactSelection = async () => {
    await showContactSelection();
    setShowContactModal(true);
  };

  const handleSelectContact = async (contactId: string) => {
    setIsSwitchingContact(true);
    try {
      const result = await selectContact(contactId);
      if (result.success) {
        setShowContactModal(false);
      } else {
        Alert.alert('Error', result.error || 'Failed to switch contact');
      }
    } catch (error) {
      console.error('Error switching contact:', error);
      Alert.alert('Error', 'An unexpected error occurred while switching contact');
    } finally {
      setIsSwitchingContact(false);
    }
  };

  const renderDashboard = () => {
    return (
      <View style={{ gap: 20 }}>
        {checkInFeedback && <CheckInFeedbackCard feedback={checkInFeedback} onDismiss={() => setCheckInFeedback(null)} />}

        <View>
          <MembershipCard
            contact={contact}
            teamProfile={teamProfile}
            initials={initials}
            collapsed={membershipCollapsed}
            onToggleCollapse={() => setMembershipCollapsed(c => !c)}
            onShowStatusModal={() => setShowStatusModal(true)}
            onShowGenderInfo={() => setShowGenderInfo(true)}
            isEditingWeight={isEditingWeight}
            weightInput={weightInput}
            onWeightInputChange={setWeightInput}
            onEditWeight={() => {
              setWeightInput(contact.weight?.toString() || '');
              setIsEditingWeight(true);
            }}
            onSaveWeight={handleUpdateWeight}
            onCancelWeightEdit={() => setIsEditingWeight(false)}
            isSavingWeight={isSavingWeight}
            membershipTerm={membershipTerm}
          />
          {teamProfile && (
            <TeamCard
              teamName={teamProfile.name}
              subscriptionName={subscriptionTypeName}
              subscriptionRecurrence={contact.subscription_recurrence}
              lastSeenAt={contact.last_seen_at}
            />
          )}
        </View>

        {alerts.length > 0 && <AlertsCard alerts={alerts} />}

        <GamificationCard
          score={contact.current_month_score}
          streak={contact.current_streak}
          maxStreak={contact.max_streak}
          leaderboardRank={myLeaderboardRank}
          variant="hero"
          onPress={() => setCurrentTab('TEAM')}
        />


        <SessionAgendaCard
          sessions={agendaSessions.filter(s => s.start >= new Date())}
          contact={contact}
          onRefresh={loadData}
          onViewAll={() => {
            scrollRef.current?.scrollTo({ y: 0, animated: false });
            setCurrentTab('TRAIN');
          }}
        />

        {teamProfile?.coachingEnabled && coachSlots.some(s => s.bookingStatus === 'available') && (
          <CoachingDashboardCard
            slots={coachSlots}
            contact={contact}
            onRefresh={loadData}
            onViewMore={() => {
            scrollRef.current?.scrollTo({ y: 0, animated: false });
            setCoachingCollapsed(false);
            setCoachCarouselOpen(true);
            setCurrentTab('TRAIN');
            setTimeout(() => setCoachCarouselOpen(false), 600);
          }}
          />
        )}

        {teamProfile && (teamProfile.referralEnabled || teamProfile.socialLinks?.some(l => l.platform === 'instagram' || l.platform === 'review')) && (
          <View>
            <Text variant="titleLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface }]}>Support the Team</Text>
            <SocialActionsCard teamProfile={teamProfile} rewardedCount={rewardedCount} />
          </View>
        )}
      </View>
    );
  };

  const renderSelfTab = () => (
    <View style={styles.selfTabContainer}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable
          onPress={handleShowContactSelection}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: theme.colors.surface, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Icon source="account-switch" size={24} color={theme.colors.primary} />
          <Text variant="labelLarge" style={{ color: theme.colors.primary, fontWeight: '700', textAlign: 'center' }}>SWITCH ACCOUNT</Text>
        </Pressable>

        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: theme.colors.surface, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Icon source="logout" size={24} color="#EF4444" />
          <Text variant="labelLarge" style={{ color: '#EF4444', fontWeight: '700', textAlign: 'center' }}>SIGN OUT</Text>
        </Pressable>
      </View>

      <Surface style={styles.infoCard} elevation={1}>
        <View style={styles.infoSection}>
          <Text variant="titleMedium" style={styles.infoSectionTitle}>CONTACT INFORMATION</Text>

          <View style={styles.infoRow}>
            <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(14, 165, 233, 0.15)' : '#E0F2FE' }]}>
              <Icon source="email-outline" size={20} color={theme.dark ? '#5DB0FF' : '#0EA5E9'} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="labelSmall" style={[styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>EMAIL ADDRESS</Text>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>{contact.email || email || 'N/A'}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(34, 197, 94, 0.15)' : '#F0FDF4' }]}>
              <Icon source="phone-outline" size={20} color={theme.dark ? '#4ADE80' : '#22C55E'} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="labelSmall" style={[styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>PHONE NUMBER</Text>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>{contact.phone || 'N/A'}</Text>
            </View>
          </View>

          {contact.residence && (
            <View style={styles.infoRow}>
              <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(249, 115, 22, 0.15)' : '#FFF7ED' }]}>
                <Icon source="map-marker-outline" size={20} color={theme.dark ? '#FB923C' : '#F97316'} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text variant="labelSmall" style={[styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>RESIDENCE</Text>
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>
                  {formatResidence(contact.residence)}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant, marginHorizontal: 20 }]} />

        <View style={styles.infoSection}>
          <Text variant="titleMedium" style={styles.infoSectionTitle}>PERSONAL DETAILS</Text>

          <View style={styles.infoRow}>
            <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF' }]}>
              <Icon source="cake-variant-outline" size={20} color={theme.dark ? '#818CF8' : '#6366F1'} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="labelSmall" style={[styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>BIRTHDATE & BIRTHPLACE</Text>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>
                {formatDateValue(contact.birthdate) || 'N/A'}{contact.birthplace ? ` in ${contact.birthplace}` : ''}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(168, 85, 247, 0.15)' : '#F5F3FF' }]}>
              <Icon source="gender-male-female" size={20} color={theme.dark ? '#A855F7' : '#7C3AED'} />
            </View>
            <View style={styles.infoTextContainer}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="labelSmall" style={[styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>GENDER</Text>
                <TouchableRipple onPress={() => setShowGenderInfo(true)}>
                  <Icon source="information-outline" size={14} color={theme.colors.onSurfaceVariant} />
                </TouchableRipple>
              </View>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>{formatGender(contact.gender) || 'N/A'}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(59, 130, 246, 0.15)' : '#DBEAFE' }]}>
              <Icon source="card-account-details-outline" size={20} color={theme.dark ? '#60A5FA' : '#3B82F6'} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text variant="labelSmall" style={[styles.infoLabel, { color: theme.colors.onSurfaceVariant }]}>COD. FISC. • AHV/AVS • TAX ID</Text>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>{contact.taxnumber || 'N/A'}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant, marginHorizontal: 20 }]} />

        <View style={styles.infoSection}>
          <Text variant="titleMedium" style={[styles.infoSectionTitle, { color: theme.colors.onSurfaceVariant }]}>EMERGENCY CONTACT</Text>
          {contact.emergencyContact ? (
            <View style={styles.infoRow}>
              <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2' }]}>
                <Icon source="account-alert-outline" size={20} color={theme.dark ? '#F87171' : '#EF4444'} />
              </View>
              <View style={styles.infoTextContainer}>
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurface }}>{contact.emergencyContact.name}</Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{contact.emergencyContact.phone}</Text>
              </View>
            </View>
          ) : (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, paddingLeft: 52 }}>No emergency contact configured.</Text>
          )}
        </View>

        <TouchableRipple
          onPress={() => setShowUpdateModal(true)}
          style={[styles.requestUpdateButton, { borderTopColor: theme.colors.outlineVariant }]}
        >
          <View style={styles.requestUpdateContent}>
            <Text style={[styles.requestUpdateText, { color: theme.colors.primary }]}>Request Information Update</Text>
            <Icon source="chevron-right" size={20} color={theme.colors.primary} />
          </View>
        </TouchableRipple>
      </Surface>

    </View>
    );

  const renderFeedTab = () => (
    <View style={styles.placeholderTab}>
      <Icon source="newspaper-variant-outline" size={48} color={theme.dark ? '#94A3B8' : '#64748B'} />
      <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
        Feed coming soon
      </Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
        News, events and updates from your team will appear here.
      </Text>
    </View>
  );

  const getRankColor = (rank: number) => {
    if (rank === 1) return '#EAB308';
    if (rank === 2) return theme.dark ? '#D1D5DB' : '#9CA3AF';
    if (rank === 3) return '#CD7F32';
    return theme.colors.onSurfaceVariant;
  };

  const renderLeaderboard = () => {
    if (!leaderboard || leaderboard.entries.length === 0) {
      return (
        <View style={styles.placeholderTab}>
          <Icon source="trophy-outline" size={48} color={theme.dark ? '#EAB308' : '#F59E0B'} />
          <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
            No scores yet this month
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            Attend sessions to earn points!
          </Text>
        </View>
      );
    }

    let currentRank = 1;
    const getSortValue = (e: typeof leaderboard.entries[0]) => {
      if (lbSort === 'streak') return e.streak || 0;
      if (lbSort === 'best_streak') return e.max_streak || 0;
      return e.score;
    };
    const processedEntries: (typeof leaderboard.entries[0] & { displayRank: number })[] = [];
    for (let i = 0; i < sortedLeaderboardEntries.length; i++) {
      if (i > 0 && getSortValue(sortedLeaderboardEntries[i]) < getSortValue(sortedLeaderboardEntries[i - 1])) currentRank++;
      if (currentRank > 5) break;
      processedEntries.push({ ...sortedLeaderboardEntries[i], displayRank: currentRank });
    }

    return (
      <View>
        <Text variant="titleLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface }]}>Monthly Leaderboard</Text>
        <Surface style={[styles.infoCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{leaderboard.month}</Text>
            <Surface style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: theme.colors.secondaryContainer }} elevation={0}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSecondaryContainer, fontWeight: '700' }}>TOP 5</Text>
            </Surface>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            {(['points', 'streak', 'best_streak'] as const).map((opt) => {
              const active = lbSort === opt;
              const label = opt === 'points' ? 'Points' : opt === 'streak' ? 'Streak' : 'Best streak';
              return (
                <TouchableRipple key={opt} onPress={() => setLbSort(opt)} borderless style={{ borderRadius: 12 }}>
                  <View style={active ? {
                    backgroundColor: theme.colors.primaryContainer,
                    borderRadius: 12,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  } : { paddingHorizontal: 2, paddingVertical: 3 }}>
                    <Text
                      variant="labelMedium"
                      style={{
                        color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant,
                        fontWeight: active ? '700' : '400',
                      }}
                    >
                      {label}
                    </Text>
                  </View>
                </TouchableRipple>
              );
            })}
          </View>
          {processedEntries.map((entry) => {
            const isCurrentUser = entry.contact_id === contact?.id;
            const isTrial = entry.type === 'trial';
            const lastInitial = entry.lastname ? ` ${entry.lastname[0]}.` : '';
            const fullName = isTrial
              ? ([entry.firstname?.[0], entry.lastname?.[0]].filter(Boolean).join('.') || '?') + '.'
              : `${entry.firstname || ''}${lastInitial}`.trim() || 'Unknown';
            const rank = entry.displayRank;
            const primaryValue = getSortValue(entry);
            const primaryUnit = lbSort === 'points' ? 'pts' : 'w';
            const primaryIcon = lbSort === 'points' ? undefined : lbSort === 'streak' ? 'fire' : 'trophy';
            const primaryColor = lbSort === 'points' ? theme.colors.onSurface : lbSort === 'streak' ? '#2563EB' : '#D97706';
            return (
              <View
                key={entry.contact_id}
                style={[
                  styles.leaderboardRow,
                  { borderBottomColor: theme.colors.outlineVariant },
                  isCurrentUser && { backgroundColor: theme.dark ? 'rgba(93,176,255,0.1)' : '#EFF6FF', borderRadius: 8 },
                ]}
              >
                <View style={[styles.rankBadge, { backgroundColor: rank <= 3 ? getRankColor(rank) + '20' : theme.colors.surfaceVariant, flexDirection: 'row', gap: 2, minWidth: rank <= 3 ? 48 : 32, paddingHorizontal: 4 }]}>
                  {rank <= 3 && <Icon source="trophy" size={14} color={getRankColor(rank)} />}
                  <Text style={[styles.rankText, { color: getRankColor(rank) }]}>{rank}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={{ fontWeight: isCurrentUser ? '700' : '400', color: theme.colors.onSurface }} numberOfLines={1}>
                    {fullName}{isTrial && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}> - Trial</Text>}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {primaryIcon && <Icon source={primaryIcon} size={14} color={primaryColor} />}
                  <Text variant="bodyMedium" style={{ fontWeight: '900', color: primaryColor }}>{primaryValue}</Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{primaryUnit}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </Surface>
      </View>
    );
  };

  const renderTeamTab = () => {
    // Only custom links here; "page links" (booking/signup/shop/space) are system
    // surfaces, surfaced by the app's own navigation rather than as plain links.
    const generalLinks = (teamProfile?.links || []).filter((l) => !l.target);
    const websiteLink = teamProfile?.socialLinks?.find((s) => s.platform === 'website');
    const legalLinks = teamProfile?.legalLinks;
    const hasLegal = !!(legalLinks?.gtcUrl || legalLinks?.privacyPolicyUrl || legalLinks?.regulationUrl);
    const coaches = teamProfile?.coaches || [];

    const toggleTeamCard = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTeamCardCollapsed(c => !c);
    };


    const hasSupportUs = !!(teamProfile?.referralEnabled || teamProfile?.socialLinks?.some(l => l.platform === 'instagram'));

    return (
      <View style={{ gap: 16 }}>
        {/* Team info card */}
        {teamProfile && (
          <Surface style={[styles.infoCard, { backgroundColor: theme.colors.surface }]} elevation={1}>
            {/* Always-visible header */}
            <View style={styles.infoSection}>
              <Text variant="headlineSmall" style={{ fontWeight: '800', color: theme.colors.onSurface, marginBottom: 4 }}>
                {teamProfile.name}
              </Text>
              {teamProfile.description ? (
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, lineHeight: 20 }}>
                  {teamProfile.description}
                </Text>
              ) : null}
            </View>

            {/* LINKS toggle row — always visible */}
            <TouchableRipple onPress={toggleTeamCard} style={styles.infoSection}>
              <View style={styles.teamCardHandleInner}>
                <Text variant="titleMedium" style={[styles.infoSectionTitle, { color: theme.colors.onSurfaceVariant, marginBottom: 0 }]}>LINKS</Text>
                <Icon source={teamCardCollapsed ? 'chevron-down' : 'chevron-up'} size={18} color={theme.colors.onSurfaceVariant} />
              </View>
            </TouchableRipple>

            {!teamCardCollapsed && (
              <>
                {/* Coaches */}
                {coaches.length > 0 && (
                  <>
                    <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant, marginHorizontal: 20 }]} />
                    <View style={styles.infoSection}>
                      <Text variant="titleMedium" style={[styles.infoSectionTitle, { color: theme.colors.onSurfaceVariant }]}>COACHES</Text>
                      {coaches.map((coach, idx) => (
                        <View key={idx} style={[styles.infoRow, { paddingVertical: 4 }]}>
                          <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(34,197,94,0.12)' : '#F0FDF4' }]}>
                            <Icon source="account-tie" size={20} color={theme.dark ? '#4ADE80' : '#16A34A'} />
                          </View>
                          <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>{coach.name}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {/* General links + website */}
                {(generalLinks.length > 0 || websiteLink) && (
                  <>
                    <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant, marginHorizontal: 20 }]} />
                    <View style={styles.infoSection}>
                      {/* links content only, heading is the toggle above */}
                      {websiteLink && (
                        <TouchableRipple onPress={() => Linking.openURL(websiteLink.url).catch(() => undefined)}>
                          <View style={[styles.infoRow, { paddingVertical: 4 }]}>
                            <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(99,102,241,0.15)' : '#EEF2FF' }]}>
                              <Icon source="web" size={20} color={theme.dark ? '#818CF8' : '#6366F1'} />
                            </View>
                            <View style={styles.infoTextContainer}>
                              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>Website</Text>
                            </View>
                            <Icon source="chevron-right" size={18} color={theme.colors.onSurfaceVariant} />
                          </View>
                        </TouchableRipple>
                      )}
                      {generalLinks.map((link, idx) => (
                        <TouchableRipple key={idx} onPress={() => { if (link.url) Linking.openURL(link.url).catch(() => undefined) }}>
                          <View style={[styles.infoRow, { paddingVertical: 4 }]}>
                            <View style={[styles.infoIconContainer, { backgroundColor: theme.dark ? 'rgba(99,102,241,0.15)' : '#EEF2FF' }]}>
                              <Icon source="link-variant" size={20} color={theme.dark ? '#818CF8' : '#6366F1'} />
                            </View>
                            <View style={styles.infoTextContainer}>
                              <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>{link.label}</Text>
                              {link.description ? (
                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{link.description}</Text>
                              ) : null}
                            </View>
                            <Icon source="chevron-right" size={18} color={theme.colors.onSurfaceVariant} />
                          </View>
                        </TouchableRipple>
                      ))}
                    </View>
                  </>
                )}

                {/* Legal links */}
                {hasLegal && (
                  <>
                    <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant, marginHorizontal: 20 }]} />
                    <View style={[styles.infoSection, { gap: 0 }]}>
                      <Text variant="titleMedium" style={[styles.infoSectionTitle, { color: theme.colors.onSurfaceVariant, marginBottom: 8 }]}>LEGAL</Text>
                      {legalLinks?.gtcUrl ? (
                        <TouchableRipple onPress={() => Linking.openURL(legalLinks.gtcUrl!).catch(() => undefined)}>
                          <View style={[styles.infoRow, { paddingVertical: 10 }]}>
                            <Icon source="file-document-outline" size={18} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>General Terms & Conditions</Text>
                            <Icon source="chevron-right" size={18} color={theme.colors.onSurfaceVariant} />
                          </View>
                        </TouchableRipple>
                      ) : null}
                      {legalLinks?.privacyPolicyUrl ? (
                        <TouchableRipple onPress={() => Linking.openURL(legalLinks.privacyPolicyUrl!).catch(() => undefined)}>
                          <View style={[styles.infoRow, { paddingVertical: 10 }]}>
                            <Icon source="shield-lock-outline" size={18} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>Privacy Policy</Text>
                            <Icon source="chevron-right" size={18} color={theme.colors.onSurfaceVariant} />
                          </View>
                        </TouchableRipple>
                      ) : null}
                      {legalLinks?.regulationUrl ? (
                        <TouchableRipple onPress={() => Linking.openURL(legalLinks.regulationUrl!).catch(() => undefined)}>
                          <View style={[styles.infoRow, { paddingVertical: 10 }]}>
                            <Icon source="clipboard-text-outline" size={18} color={theme.colors.onSurfaceVariant} />
                            <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>Regulation</Text>
                            <Icon source="chevron-right" size={18} color={theme.colors.onSurfaceVariant} />
                          </View>
                        </TouchableRipple>
                      ) : null}
                    </View>
                  </>
                )}
              </>
            )}

          </Surface>
        )}

        {/* Support us — standalone card */}
        {teamProfile && hasSupportUs && (
          <View>
            <Text variant="titleLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface }]}>Support Us</Text>
            <SocialActionsCard teamProfile={teamProfile} rewardedCount={rewardedCount} />
          </View>
        )}

        {renderLeaderboard()}
      </View>
    );
  };

  const renderProgressTab = () => {
    return (
      <View style={{ gap: 16 }}>
        <GamificationCard
          score={contact.current_month_score}
          streak={contact.current_streak}
          maxStreak={contact.max_streak}
        />

        <TrainingActivity
          contactId={contact.id}
          teamId={contact.teamId}
          contact={contact}
        />

        <PerformanceProfileSection contactId={contact.id} teamId={contact.teamId || ''} />

        {teamProfile?.coachingEnabled && coachSlots.length > 0 && (
          <View>
            <TouchableRipple
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setCoachingCollapsed(c => !c);
              }}
              borderless
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text variant="titleLarge" style={[styles.sectionLabel, { color: theme.colors.onSurface, marginBottom: 0 }]}>Coaching</Text>
                <Icon source={coachingCollapsed ? 'chevron-down' : 'chevron-up'} size={20} color={theme.colors.onSurfaceVariant} />
              </View>
            </TouchableRipple>
            {!coachingCollapsed && (
              <CoachSlotsCarousel
                slots={coachSlots}
                contact={contact}
                onRefresh={loadData}
                open={coachCarouselOpen}
              />
            )}
          </View>
        )}

        <GoalsSection contactId={contact.id} teamId={contact.teamId || ''} />

        <BadgesCard
          contact={contact}
          badgeThresholds={gamificationSettings?.badge_thresholds}
          coachBadges={gamificationSettings?.coach_badges}
        />
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <LoadingOverlay visible={isLoading && !isRefreshing} message="Updating..." />

      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <ProfileHeader
          contact={contact}
          initials={initials}
          onShowQR={handleShowQR}
          onScanDojoQR={() => setShowScannerModal(true)}
          onEditProfile={() => setCurrentTab(currentTab === 'SELF' ? 'DASH' : 'SELF')}
        />

        {currentTab === 'DASH' && renderDashboard()}
        {currentTab === 'FEED' && renderFeedTab()}
        {currentTab === 'TRAIN' && renderProgressTab()}
        {currentTab === 'TEAM' && renderTeamTab()}
        {currentTab === 'SELF' && renderSelfTab()}

        <View style={{ height: 100 + insets.bottom }} />
      </ScrollView>

      {/* Bottom Navigation */}
      <Surface style={[styles.bottomNav, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom, height: 85 + insets.bottom }]} elevation={4}>
        {(['DASH', 'FEED', 'TRAIN', 'TEAM'] as TabType[]).map((tab) => {
          const icon = tab === 'DASH' ? 'view-dashboard'
            : tab === 'FEED' ? 'newspaper'
            : tab === 'TRAIN' ? 'chart-timeline-variant'
            : 'account-group';
          const active = currentTab === tab;
          return (
            <TouchableRipple key={tab} onPress={() => setCurrentTab(tab)} style={styles.navItem}>
              <View style={styles.navItemContent}>
                <IconButton
                  icon={icon}
                  size={24}
                  iconColor={active ? theme.colors.primary : theme.colors.onSurfaceVariant}
                  style={styles.navIcon}
                />
                <Text
                  variant="labelSmall"
                  style={{ color: active ? theme.colors.primary : theme.colors.onSurfaceVariant, fontWeight: active ? '700' : '500' }}
                >
                  {tab}
                </Text>
              </View>
            </TouchableRipple>
          );
        })}
      </Surface>

      <ProfileModals
        contact={contact}
        teamProfile={teamProfile}
        showQRModal={showQRModal}
        onCloseQR={() => setShowQRModal(false)}
        isLoadingQR={isLoadingQR}
        qrData={qrData}
        showStatusModal={showStatusModal}
        onCloseStatus={() => setShowStatusModal(false)}
        showGenderInfo={showGenderInfo}
        onCloseGenderInfo={() => setShowGenderInfo(false)}
        showContactModal={showContactModal}
        onCloseContactModal={() => setShowContactModal(false)}
        matchedContacts={matchedContacts}
        onSelectContact={handleSelectContact}
        isSwitchingContact={isSwitchingContact}
        membershipTerm={membershipTerm}
      />

      <ProfileUpdateModal
        visible={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        contact={contact}
        onSuccess={() => setShowUpdateSuccess(true)}
      />

      <TeamQrScannerModal
        visible={showScannerModal}
        onScan={handleTeamQrScanned}
        onClose={() => setShowScannerModal(false)}
      />

      <SessionPickerModal
        visible={showSessionPicker}
        sessions={scanSessions}
        loading={checkInLoading}
        onSelect={handleSessionPicked}
        onClose={() => { setShowSessionPicker(false); setPendingTeamSlug(null); }}
      />

      <Snackbar
        visible={showUpdateSuccess}
        onDismiss={() => setShowUpdateSuccess(false)}
        duration={4000}
        style={{ marginBottom: 20 }}
      >
        Update request submitted successfully!
      </Snackbar>

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 20,
  },
  selfTabContainer: {
    gap: 16,
  },
  infoCard: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  infoSection: {
    padding: 20,
    gap: 16,
  },
  infoSectionTitle: {
    color: '#64748B',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 4,
  },
  sectionLabel: {
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  infoIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoTextContainer: {
    flex: 1,
  },
  infoLabel: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 10,
    marginBottom: 2,
  },
  separator: {
    height: 1,
  },
  requestUpdateButton: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    padding: 16,
  },
  requestUpdateContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  requestUpdateText: {
    fontWeight: '700',
    fontSize: 14,
  },
  teamCardHandleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoutAction: {
    width: '100%',
    padding: 10,
    alignItems: 'center',
  },
  actionButton: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 20,
    elevation: 1,
  },
  placeholderTab: {
    padding: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    gap: 12,
  },
  rankBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankText: {
    fontSize: 13,
    fontWeight: '700',
  },
  bottomNav: {
    height: 85,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#FFFFFF', // Fallback
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navItemContent: {
    alignItems: 'center',
  },
  navIcon: {
    margin: 0,
    padding: 0,
  },
});
