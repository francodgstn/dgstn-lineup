import React, { useMemo, useState } from 'react';
import { StyleSheet, View, Pressable, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Icon, Surface, Text, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { Contact, BadgeThresholds, CoachBadgeConfig, RankingSystem } from '../../types';
import { resolvePrimaryRank } from '../../utils/profileUtils';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Badge {
  id: string;
  label: string;
  description: string;
  icon: string;
  gradient: [string, string];
  earned: boolean;
  coachAssigned?: boolean;
}

interface BadgeGroup {
  title: string;
  icon: string;
  badges: Badge[];
}

interface BadgesCardProps {
  contact: Contact;
  badgeThresholds?: BadgeThresholds | null;
  coachBadges?: CoachBadgeConfig[] | null;
  /** The tenant's effective ranking systems. Empty = no Rank badge group. */
  rankingSystems?: RankingSystem[];
}

const DEFAULT_THRESHOLDS: BadgeThresholds = {
  attendance: { enabled: true, first_class: 1, dedicated: 10, committed: 50, centurion: 100, veteran: 200 },
  streak: { enabled: true, on_fire: 4, unstoppable: 8, legendary: 12 },
  score: { enabled: true, rising_star: 30, monthly_star: 60, superstar: 90 },
  leaderboard: { enabled: true, leader: 1, top5: 1, hall_of_fame: 5 },
  explorer: { enabled: true, explorer: 2 },
};

// Coach badge icons are stored as MaterialCommunityIcons names directly
// (matching react-native-paper's Icon component)

const COACH_BADGE_GRADIENTS: Record<string, [string, string]> = {
  tournament_ready: ['#EF4444', '#991B1B'],
  forms_expert: ['#8B5CF6', '#5B21B6'],
  kick_pro: ['#F59E0B', '#B45309'],
  flying_kick: ['#06B6D4', '#0E7490'],
};

const DEFAULT_COACH_GRADIENT: [string, string] = ['#6366F1', '#4338CA'];
const DEFAULT_COACH_ICON = 'star-circle';

const DEFAULT_COACH_BADGES: CoachBadgeConfig[] = [
  { key: 'tournament_ready', label: 'Tournament', icon: 'sword-cross', description: 'Ready for competition' },
  { key: 'forms_expert', label: 'Forms Expert', icon: 'yin-yang', description: 'Excellence in traditional forms' },
  { key: 'kick_pro', label: 'Kick Pro', icon: 'karate', description: 'Strong kicking technique' },
  { key: 'flying_kick', label: 'Flying Kick', icon: 'rocket-launch', description: 'Achieved flying kicks' },
];

/**
 * Rank badges as PROPORTIONS of whatever scale the tenant configured.
 *
 * These were absolute numbers against HMD's 15-belt ladder — `rank >= 3`,
 * `>= 7`, `>= 11`, `>= 14` — which meant two things: every badge but the first
 * became unearnable the moment the migration moved ranks out of the scalar this
 * file read, and the whole group was meaningless for a club on a five-level
 * scale.
 *
 * The fractions below reproduce HMD's own thresholds exactly on a 0-14 ladder
 * (3/14, 7/14, 11/14) while meaning something on any other. `master` is the top
 * of the scale rather than a fraction, because "the highest grade" is the claim.
 */
const RANK_BADGE_FRACTIONS = { intermediate: 0.2, advanced: 0.5, blackBelt: 0.75 } as const;

const getBadgeGroups = (
  contact: Contact,
  thresholds: BadgeThresholds,
  coachBadgeList: CoachBadgeConfig[],
  rankingSystems: RankingSystem[],
): BadgeGroup[] => {
  const resolved = resolvePrimaryRank(contact, rankingSystems);
  const levels = [...(resolved?.system?.levels ?? [])].sort((a, b) => a.value - b.value);
  const position = resolved ? levels.findIndex((l) => l.value === resolved.value) : -1;
  const top = levels.length - 1;
  const fraction = position >= 0 && top > 0 ? position / top : 0;
  /** The label a tenant's own scale gives the level at `f` — so the badge says
   *  "Reach Blue" for HMD and "Reach Purple" for a BJJ club, instead of naming
   *  one organisation's belts to everybody. */
  const labelAt = (f: number) => levels[Math.ceil(f * top)]?.label ?? '';
  const sessions = contact.total_sessions_count ?? 0;
  const maxStreak = contact.max_streak ?? 0;
  const monthScore = contact.current_month_score ?? 0;
  const distinctActivities = contact.distinct_activities?.length ?? 0;

  const weight = contact.weight ?? 0;
  const timesLeader = contact.times_leader ?? 0;
  const timesTop5 = contact.times_top5 ?? 0;

  const a = thresholds.attendance;
  const s = thresholds.streak;
  const sc = thresholds.score;
  const lb = thresholds.leaderboard;
  const ex = thresholds.explorer;

  const groups: BadgeGroup[] = []

  // Only when the tenant actually uses ranks. A club with no ranking system was
  // shown five permanently-locked belt badges that meant nothing to it.
  if (resolved && levels.length > 1) {
    groups.push({
      title: 'Rank',
      icon: 'shield-outline',
      badges: [
        { id: 'beginner', label: 'Beginner', description: 'Start your journey', icon: 'white-balance-sunny', gradient: ['#E0E0E0', '#BDBDBD'], earned: true },
        { id: 'intermediate', label: 'Intermediate', description: `Reach ${labelAt(RANK_BADGE_FRACTIONS.intermediate)}`, icon: 'shield-half-full', gradient: ['#FF9A3C', '#FF6B1B'], earned: fraction >= RANK_BADGE_FRACTIONS.intermediate },
        { id: 'advanced', label: 'Advanced', description: `Reach ${labelAt(RANK_BADGE_FRACTIONS.advanced)}`, icon: 'shield-star', gradient: ['#42A5F5', '#1565C0'], earned: fraction >= RANK_BADGE_FRACTIONS.advanced },
        { id: 'black-belt', label: 'Black Belt', description: `Reach ${labelAt(RANK_BADGE_FRACTIONS.blackBelt)}`, icon: 'karate', gradient: ['#555555', '#1A1A1A'], earned: fraction >= RANK_BADGE_FRACTIONS.blackBelt },
        { id: 'master', label: 'Master', description: `Reach ${levels[top]?.label ?? 'the highest grade'}`, icon: 'crown', gradient: ['#FFD700', '#F59E0B'], earned: position === top },
      ],
    })
  }

  const attendanceBadges: Badge[] = [];
  if (a.enabled !== false) {
    attendanceBadges.push(
      { id: 'first-class', label: 'First Class', description: `Attend ${a.first_class === 1 ? 'your first session' : `${a.first_class} sessions`}`, icon: 'shoe-sneaker', gradient: ['#34D399', '#059669'], earned: sessions >= a.first_class },
      { id: 'dedicated', label: 'Dedicated', description: `Attend ${a.dedicated} sessions`, icon: 'dumbbell', gradient: ['#60A5FA', '#2563EB'], earned: sessions >= a.dedicated },
      { id: 'committed', label: 'Committed', description: `Attend ${a.committed} sessions`, icon: 'arm-flex', gradient: ['#A78BFA', '#7C3AED'], earned: sessions >= a.committed },
      { id: 'centurion', label: 'Centurion', description: `Attend ${a.centurion} sessions`, icon: 'medal', gradient: ['#FBBF24', '#D97706'], earned: sessions >= a.centurion },
      { id: 'veteran', label: 'Veteran', description: `Attend ${a.veteran} sessions`, icon: 'trophy-award', gradient: ['#F97316', '#C2410C'], earned: sessions >= a.veteran },
    );
  }
  if (s.enabled !== false) {
    attendanceBadges.push(
      { id: 'on-fire', label: 'On Fire', description: `Reach a ${s.on_fire}-week streak`, icon: 'fire', gradient: ['#F87171', '#DC2626'], earned: maxStreak >= s.on_fire },
      { id: 'unstoppable', label: 'Unstoppable', description: `Reach a ${s.unstoppable}-week streak`, icon: 'lightning-bolt', gradient: ['#818CF8', '#4F46E5'], earned: maxStreak >= s.unstoppable },
      { id: 'legendary', label: 'Legendary', description: `Reach a ${s.legendary}-week streak`, icon: 'star-shooting', gradient: ['#F472B6', '#BE185D'], earned: maxStreak >= s.legendary },
    );
  }
  if (attendanceBadges.length > 0) {
    groups.push({
      title: 'Attendance & Streak',
      icon: 'calendar-check-outline',
      badges: attendanceBadges,
    });
  }

  const scoreBadges: Badge[] = [];
  if (sc.enabled !== false) {
    scoreBadges.push(
      { id: 'rising-star', label: 'Rising Star', description: `Score ${sc.rising_star}+ points in a month`, icon: 'star-outline', gradient: ['#60A5FA', '#2563EB'], earned: monthScore >= sc.rising_star },
      { id: 'monthly-star', label: 'Monthly Star', description: `Score ${sc.monthly_star}+ points in a month`, icon: 'star-circle', gradient: ['#FBBF24', '#EA580C'], earned: monthScore >= sc.monthly_star },
      { id: 'superstar', label: 'Superstar', description: `Score ${sc.superstar}+ points in a month`, icon: 'star-shooting', gradient: ['#F472B6', '#9333EA'], earned: monthScore >= sc.superstar },
    );
  }
  if (lb.enabled !== false) {
    scoreBadges.push(
      { id: 'top-5', label: 'Top 5', description: `Finish in the top 5 ${lb.top5 === 1 ? 'once' : `${lb.top5} times`}`, icon: 'numeric-5-circle-outline', gradient: ['#60A5FA', '#2563EB'], earned: timesTop5 >= lb.top5 },
      { id: 'leader', label: 'Leader', description: `Finish #1 ${lb.leader === 1 ? 'once' : `${lb.leader} times`}`, icon: 'trophy', gradient: ['#FBBF24', '#D97706'], earned: timesLeader >= lb.leader },
      { id: 'hall-of-fame', label: 'Hall of Fame', description: `Finish in the top 5 ${lb.hall_of_fame}+ times`, icon: 'star-face', gradient: ['#F472B6', '#9333EA'], earned: timesTop5 >= lb.hall_of_fame },
    );
  }
  if (scoreBadges.length > 0) {
    groups.push({
      title: 'Score & Leaderboard',
      icon: 'podium',
      badges: scoreBadges,
    });
  }

  const customBadges = contact.custom_badges ?? [];

  const specialBadges: Badge[] = [];
  if (ex.enabled !== false) {
    specialBadges.push(
      { id: 'explorer', label: 'Explorer', description: `Train in ${ex.explorer}+ different activities`, icon: 'compass-outline', gradient: ['#2DD4BF', '#0D9488'], earned: distinctActivities >= ex.explorer },
    );
  }
  specialBadges.push(
    { id: 'iron-will', label: 'Iron Will', description: 'Update your weight', icon: 'kettlebell', gradient: ['#78716C', '#44403C'], earned: weight > 10 },
    ...coachBadgeList.map((cb) => {
      const rnIcon = cb.icon || DEFAULT_COACH_ICON;
      const gradient = COACH_BADGE_GRADIENTS[cb.key] || DEFAULT_COACH_GRADIENT;
      return {
        id: `coach-${cb.key}`,
        label: cb.label,
        description: cb.description || 'Assigned by your coach',
        icon: rnIcon,
        gradient,
        earned: customBadges.includes(cb.key),
        coachAssigned: true,
      };
    }),
  );
  if (specialBadges.length > 0) {
    groups.push({
      title: 'Special',
      icon: 'creation',
      badges: specialBadges,
    });
  }

  return groups;
};

export const BadgesCard: React.FC<BadgesCardProps> = ({ contact, badgeThresholds, coachBadges, rankingSystems }) => {
  const theme = useTheme();
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);
  const mergedThresholds = useMemo<BadgeThresholds>(() => ({
    attendance: { ...DEFAULT_THRESHOLDS.attendance, ...badgeThresholds?.attendance },
    streak: { ...DEFAULT_THRESHOLDS.streak, ...badgeThresholds?.streak },
    score: { ...DEFAULT_THRESHOLDS.score, ...badgeThresholds?.score },
    leaderboard: { ...DEFAULT_THRESHOLDS.leaderboard, ...badgeThresholds?.leaderboard },
    explorer: { ...DEFAULT_THRESHOLDS.explorer, ...badgeThresholds?.explorer },
  }), [badgeThresholds]);

  const resolvedCoachBadges = coachBadges || DEFAULT_COACH_BADGES;
  const groups = useMemo(() => getBadgeGroups(contact, mergedThresholds, resolvedCoachBadges, rankingSystems ?? []), [contact, mergedThresholds, resolvedCoachBadges, rankingSystems]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    new Set(getBadgeGroups(contact, {
      attendance: { ...DEFAULT_THRESHOLDS.attendance, ...badgeThresholds?.attendance },
      streak: { ...DEFAULT_THRESHOLDS.streak, ...badgeThresholds?.streak },
      score: { ...DEFAULT_THRESHOLDS.score, ...badgeThresholds?.score },
      leaderboard: { ...DEFAULT_THRESHOLDS.leaderboard, ...badgeThresholds?.leaderboard },
      explorer: { ...DEFAULT_THRESHOLDS.explorer, ...badgeThresholds?.explorer },
    }, coachBadges || DEFAULT_COACH_BADGES, rankingSystems ?? []).map(g => g.title))
  );
  const allBadges = groups.flatMap(g => g.badges);
  const earnedCount = allBadges.filter(b => b.earned).length;

  const toggleGroup = (title: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
        if (selectedBadge && groups.find(g => g.title === title)?.badges.some(b => b.id === selectedBadge.id)) {
          setSelectedBadge(null);
        }
      }
      return next;
    });
  };

  const handleBadgeTap = (badge: Badge) => {
    setSelectedBadge(prev => prev?.id === badge.id ? null : badge);
  };

  const renderBadge = (badge: Badge) => (
    <Pressable key={badge.id} onPress={() => handleBadgeTap(badge)} style={styles.badgeItem}>
      <View>
        {badge.earned ? (
          <LinearGradient
            colors={badge.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.badgeCircle,
              selectedBadge?.id === badge.id && { borderWidth: 2.5, borderColor: theme.colors.primary },
            ]}
          >
            <Icon source={badge.icon} size={32} color="#FFFFFF" />
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.badgeCircle,
              {
                backgroundColor: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                borderWidth: selectedBadge?.id === badge.id ? 2.5 : 1,
                borderColor: selectedBadge?.id === badge.id
                  ? theme.colors.primary
                  : theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              },
            ]}
          >
            <Icon
              source={badge.icon}
              size={32}
              color={theme.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}
            />
            <View style={[styles.lockOverlay, { backgroundColor: theme.dark ? '#2A2A2A' : '#E5E5E5' }]}>
              <Icon source="lock" size={11} color={theme.dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)'} />
            </View>
          </View>
        )}
        {badge.coachAssigned && (
          <View style={[styles.coachOverlay, { backgroundColor: theme.dark ? '#44381A' : '#FEF3C7' }]}>
            <Icon source="medal" size={12} color={theme.dark ? '#FBBF24' : '#B45309'} />
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.badgeLabel,
          {
            color: badge.earned ? theme.colors.onSurface : theme.colors.onSurfaceVariant,
            opacity: badge.earned ? 1 : 0.4,
          },
        ]}
      >
        {badge.label}
      </Text>
    </Pressable>
  );

  const renderTooltip = () => {
    if (!selectedBadge) return null;
    return (
      <View style={[styles.tooltip, { backgroundColor: theme.dark ? '#2A2A2A' : '#F1F5F9' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon
            source={selectedBadge.earned ? 'check-circle' : 'lock-outline'}
            size={14}
            color={selectedBadge.earned ? '#10B981' : theme.colors.onSurfaceVariant}
          />
          <Text variant="labelMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1 }}>
            {selectedBadge.label}
          </Text>
        </View>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 1, marginLeft: 20 }}>
          {selectedBadge.description}
        </Text>
      </View>
    );
  };

  const selectedGroupTitle = selectedBadge
    ? groups.find(g => g.badges.some(b => b.id === selectedBadge.id))?.title ?? null
    : null;

  return (
    <View style={{ marginBottom: 4 }}>
      {/* Section heading — outside card */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 4 }}>
        <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
          Achievements
        </Text>
        <Surface style={[styles.countBadge, { backgroundColor: theme.colors.secondaryContainer }]} elevation={0}>
          <Text style={{ color: theme.colors.onSecondaryContainer, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>
            {earnedCount}/{allBadges.length}
          </Text>
        </Surface>
      </View>

    <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
      <View style={styles.content}>

        {groups.map((group, index) => {
          const isCollapsed = collapsedGroups.has(group.title);
          const groupEarned = group.badges.filter(b => b.earned).length;

          return (
            <View key={group.title} style={index > 0 ? { marginTop: 14 } : undefined}>
              <Pressable onPress={() => toggleGroup(group.title)} style={styles.groupHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <Icon source={group.icon} size={14} color={theme.colors.onSurfaceVariant} />
                  <Text style={[styles.groupTitle, { color: theme.colors.onSurfaceVariant }]}>
                    {group.title}
                  </Text>
                  <Text style={[styles.groupCount, { color: theme.colors.onSurfaceVariant }]}>
                    {groupEarned}/{group.badges.length}
                  </Text>
                </View>
                <Icon
                  source={isCollapsed ? 'chevron-down' : 'chevron-up'}
                  size={18}
                  color={theme.colors.onSurfaceVariant}
                />
              </Pressable>
              {!isCollapsed && (
                <>
                  <View style={styles.grid}>
                    {group.badges.map(renderBadge)}
                  </View>
                  {selectedGroupTitle === group.title && renderTooltip()}
                </>
              )}
            </View>
          );
        })}
      </View>
    </Surface>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  content: {
    padding: 16,
  },
  countBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  groupCount: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-start',
  },
  badgeItem: {
    alignItems: 'center',
    width: 76,
  },
  badgeCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockOverlay: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  coachOverlay: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  tooltip: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
});
