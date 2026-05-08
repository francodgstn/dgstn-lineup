import React, { useEffect, useRef } from 'react';
import { Animated, LayoutAnimation, Platform, StyleSheet, TextInput, UIManager, View } from 'react-native';
import { Card, Icon, IconButton, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { Contact, TeamPublicProfile } from '../../types';
import {
  getStatusLabel,
  getStatusColors,
  calculateAge,
  formatGender,
  getRankInfo,
} from '../../utils/profileUtils';
import { BeltBadge } from './BeltBadge';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface MembershipCardProps {
  contact: Contact;
  teamProfile: TeamPublicProfile | null;
  initials: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onShowStatusModal: () => void;
  onShowGenderInfo: () => void;
  isEditingWeight: boolean;
  weightInput: string;
  onWeightInputChange: (value: string) => void;
  onEditWeight: () => void;
  onSaveWeight: () => void;
  onCancelWeightEdit: () => void;
  isSavingWeight: boolean;
}

const PillHandle: React.FC<{
  onPress: () => void;
  rotation: Animated.AnimatedInterpolation<string>;
}> = ({ onPress, rotation }) => (
  <TouchableRipple onPress={onPress} style={styles.handleArea} borderless>
    <Animated.View style={{ transform: [{ rotate: rotation }] }}>
      <Icon source="chevron-up" size={20} color="#475569" />
    </Animated.View>
  </TouchableRipple>
);

export const MembershipCard: React.FC<MembershipCardProps> = ({
  contact,
  collapsed,
  onToggleCollapse,
  onShowStatusModal,
  onShowGenderInfo,
  isEditingWeight,
  weightInput,
  onWeightInputChange,
  onEditWeight,
  onSaveWeight,
  onCancelWeightEdit,
}) => {
  const theme = useTheme();
  const chevronAnim = useRef(new Animated.Value(collapsed ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(chevronAnim, {
      toValue: collapsed ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [collapsed]);

  const chevronRotation = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const rankInfo = getRankInfo(contact.rank || 0);

  const age = calculateAge(contact.birthdate);
  const genderLabel = formatGender(contact.gender);

  const rankTitle = rankInfo?.belt || 'NO BELT';
  const studentName = [contact.firstname, contact.lastname].filter(Boolean).join(' ').toUpperCase();
  const rankSub = `MEMBER: ${studentName}`;
  const statusColors = getStatusColors(contact.membership_status, theme.colors);

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggleCollapse();
  };

  // ── collapsed strip ──────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <Card style={styles.membershipCard}>
        <LinearGradient
          colors={['#0F172A', '#1E293B', '#0F172A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.collapsedGradient}
        >
          <View style={styles.collapsedTopRow}>
            <BeltBadge
              primaryColor={rankInfo?.badgeColor || '#DDDDDD'}
              secondaryColor={rankInfo?.secondColor}
              size={26}
            />
            <Text style={styles.collapsedRank}>{rankTitle.toUpperCase()}</Text>
            <TouchableRipple onPress={onShowStatusModal} style={styles.statusBadgeContainer}>
              <View style={[styles.statusBadge, { backgroundColor: statusColors.bg }]}>
                <Text style={[styles.statusBadgeText, { color: statusColors.text }]}>
                  {getStatusLabel(contact.membership_status).toUpperCase()}
                </Text>
              </View>
            </TouchableRipple>
          </View>
          <PillHandle onPress={handleToggle} rotation={chevronRotation} />
        </LinearGradient>
      </Card>
    );
  }

  // ── expanded card ────────────────────────────────────────────────────────────
  return (
    <Card style={styles.membershipCard}>
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Card.Content style={styles.membershipContent}>
          {/* Header Row */}
          <View style={styles.headerRow}>
            <View>
              <Text variant="labelSmall" style={styles.orgLabel}>
                HWALMOODO & KOREAN-DRAGON
              </Text>
              <Text variant="labelSmall" style={styles.orgSubLabel}>
                MEMBERSHIP CARD
              </Text>
            </View>
            <TouchableRipple onPress={onShowStatusModal} style={styles.statusBadgeContainer}>
              <View style={[styles.statusBadge, { backgroundColor: statusColors.bg }]}>
                <Text style={[styles.statusBadgeText, { color: statusColors.text }]}>
                  {getStatusLabel(contact.membership_status).toUpperCase()}
                </Text>
              </View>
            </TouchableRipple>
          </View>

          {/* Rank Section */}
          <View style={styles.rankSection}>
            <View style={styles.rankStatusRow}>
              <View style={[styles.rankAccent, { backgroundColor: '#3B82F6' }]} />
              <Text variant="labelMedium" style={styles.rankSubText}>
                {rankSub}
              </Text>
            </View>
            <View style={styles.rankTitleRow}>
              <BeltBadge
                primaryColor={rankInfo?.badgeColor || '#DDDDDD'}
                secondaryColor={rankInfo?.secondColor}
                size={32}
              />
              <Text variant="headlineMedium" style={styles.rankTitle}>
                {rankTitle.toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Separator */}
          <View style={styles.separator} />

          {/* Stats Row */}
          <View style={styles.footerRow}>
            <View style={styles.footerItem}>
              <View style={styles.statValueRow}>
                <TouchableRipple onPress={onShowGenderInfo} style={styles.statChip}>
                  <View style={styles.inlineStats}>
                    <Text variant="titleSmall" style={styles.footerValue}>{genderLabel || 'F'}</Text>
                    <Icon source="information-outline" size={14} color="#94A3B8" />
                  </View>
                </TouchableRipple>

                <Text variant="titleSmall" style={styles.statSeparator}>•</Text>
                <Text variant="titleSmall" style={styles.footerValue}>{age || '??'} yrs</Text>
                <Text variant="titleSmall" style={styles.statSeparator}>•</Text>

                {isEditingWeight ? (
                  <View style={styles.editingContainer}>
                    <TextInput
                      value={weightInput}
                      onChangeText={onWeightInputChange}
                      keyboardType="numeric"
                      style={styles.weightInput}
                      autoFocus
                      placeholderTextColor="#64748B"
                    />
                    <IconButton icon="check" size={16} iconColor="#4CAF50" onPress={onSaveWeight} style={styles.editActionIcon} />
                    <IconButton icon="close" size={16} iconColor="#FF5252" onPress={onCancelWeightEdit} style={styles.editActionIcon} />
                  </View>
                ) : (
                  <TouchableRipple onPress={onEditWeight}>
                    <View style={styles.weightValueRow}>
                      <Text variant="titleSmall" style={styles.footerValue}>
                        {contact.weight ? `${contact.weight} kg` : '?? kg'}
                      </Text>
                      <Icon source="pencil-outline" size={12} color="#94A3B8" />
                    </View>
                  </TouchableRipple>
                )}
              </View>
            </View>
          </View>
        </Card.Content>

        <PillHandle onPress={handleToggle} />
      </LinearGradient>
    </Card>
  );
};

const styles = StyleSheet.create({
  membershipCard: {
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  collapsedGradient: {
    paddingTop: 14,
    paddingHorizontal: 16,
  },
  collapsedTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  collapsedRank: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5,
    flex: 1,
  },
  gradient: {
    padding: 4,
    paddingBottom: 0,
  },
  membershipContent: {
    padding: 16,
    paddingBottom: 14,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  orgLabel: {
    color: '#3B82F6',
    fontWeight: '900',
    letterSpacing: 1.5,
    fontSize: 12,
  },
  orgSubLabel: {
    color: '#94A3B8',
    letterSpacing: 1,
    fontSize: 9,
    marginTop: 2,
  },
  statusBadgeContainer: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  rankSection: {
    marginBottom: 12,
  },
  rankStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  rankAccent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    marginRight: 8,
  },
  rankSubText: {
    color: '#94A3B8',
    letterSpacing: 1,
    fontWeight: '600',
    fontSize: 11,
  },
  rankTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rankTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    letterSpacing: 1,
    fontSize: 28,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 12,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  footerItem: {
    gap: 4,
    flex: 1,
  },
  footerValue: {
    color: '#F8FAFC',
    fontWeight: '700',
  },
  statChip: {
    borderRadius: 4,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  inlineStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statSeparator: {
    color: '#64748B',
    marginHorizontal: 8,
    fontWeight: '700',
  },
  weightValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
    paddingLeft: 4,
  },
  weightInput: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    width: 45,
    padding: 0,
    textAlign: 'center',
  },
  editActionIcon: {
    margin: 0,
    padding: 0,
  },
});
