import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Icon,
  Modal,
  Portal,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import Svg, { Circle, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';
import { FirestoreService } from '../../services/firestore';
import { TrainingIndicator, TrainingCheckin, ProfileKey } from '../../types';
import { detectTrainingProfile } from '../../utils/trainingProfile';
import { Timestamp } from 'firebase/firestore';

interface Props {
  contactId: string;
  teamId: string;
}

// ─── Axis question copy ───────────────────────────────────────────────────────

const AXIS_QUESTIONS: Record<string, string> = {
  consistency: 'How consistently did I show up to training, relative to what I intended?',
  effort: 'How much of my capacity did I genuinely invest during sessions?',
  focus: 'How mentally present and attentive was I during training?',
  recharge: 'How well did I recharge between sessions — sleep, rest, and taking care of my body?',
  sense_of_progress:
    'When I look back at this period, does my training feel like it moved me forward in a way that mattered to me?',
};

const AXIS_LABELS: Record<string, string> = {
  consistency: 'Consistency',
  effort: 'Effort',
  focus: 'Focus',
  recharge: 'Recharge',
  sense_of_progress: 'Sense of progress',
};

// ─── Profile display metadata ─────────────────────────────────────────────────

type ProfileDisplay = {
  label: string;
  color: string;
  message: (lever?: string, anchor?: string) => string;
};

const PROFILE_DISPLAY: Record<ProfileKey, ProfileDisplay> = {
  burnout_risk: {
    label: 'Burnout Risk',
    color: '#EF4444',
    message: () => "You're showing up but disengaging across key dimensions. Talk to your coach.",
  },
  overreaching: {
    label: 'Overreaching',
    color: '#F97316',
    message: () => 'High effort but poor recovery. Make sure to rest and take care of your body.',
  },
  stuck: {
    label: 'Stuck',
    color: '#EAB308',
    message: () => "You're engaged but not feeling forward movement. Ask your coach for new challenges or recognition.",
  },
  coasting: {
    label: 'Coasting',
    color: '#8B5CF6',
    message: () =>
      'Physically present, mentally elsewhere. Try setting a clear focus intention before your next session.',
  },
  inconsistent: {
    label: 'Inconsistent',
    color: '#06B6D4',
    message: () => "Great quality when you show up — consistency is the bottleneck right now.",
  },
  balanced: {
    label: 'Balanced',
    color: '#22C55E',
    message: () => 'Healthy profile across all dimensions. Keep it up!',
  },
  default: {
    label: 'Profile',
    color: '#6B7280',
    message: (lever, anchor) =>
      anchor && lever
        ? `Your ${AXIS_LABELS[anchor] ?? anchor} is strong — build from there. Your ${AXIS_LABELS[lever] ?? lever} is where the most room for improvement is right now.`
        : '',
  },
};

// ─── Radar Chart ──────────────────────────────────────────────────────────────

interface RadarChartProps {
  indicators: TrainingIndicator[];
  studentScores: Record<string, number>;
  coachScores?: Record<string, number>;
  size?: number;
  maxValue?: number;
}

const RadarChartSVG: React.FC<RadarChartProps> = ({
  indicators,
  studentScores,
  coachScores,
  size = 300,
  maxValue = 5,
}) => {
  const n = indicators.length;
  if (n < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.38;
  const labelRadius = radius + 10;

  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const polar = (r: number, i: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });

  const rings = [1, 2, 3, 4, 5];

  const buildPoints = (scores: Record<string, number>) =>
    indicators
      .map((ind, i) => {
        const val = Math.min(Math.max(scores[ind.key] ?? 0, 0), maxValue);
        const r = (val / maxValue) * radius;
        const p = polar(r, i);
        return `${p.x},${p.y}`;
      })
      .join(' ');

  const studentPoints = buildPoints(studentScores);
  const coachPoints = coachScores ? buildPoints(coachScores) : null;

  return (
    <Svg width={size} height={size}>
      {rings.map(ring => {
        const r = (ring / maxValue) * radius;
        const ringPoints = indicators
          .map((_, i) => {
            const p = polar(r, i);
            return `${p.x},${p.y}`;
          })
          .join(' ');
        return (
          <Polygon key={ring} points={ringPoints} fill="none" stroke="#CBD5E1" strokeWidth={0.8} />
        );
      })}

      {indicators.map((_, i) => {
        const outer = polar(radius, i);
        return (
          <Line key={i} x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="#CBD5E1" strokeWidth={0.8} />
        );
      })}

      {coachPoints && (
        <Polygon
          points={coachPoints}
          fill="rgba(249,115,22,0.1)"
          stroke="#F97316"
          strokeWidth={1.5}
          strokeDasharray="4 2"
        />
      )}

      <Polygon points={studentPoints} fill="rgba(59,130,246,0.18)" stroke="#3B82F6" strokeWidth={2} />
      <Circle cx={cx} cy={cy} r={3} fill="#3B82F6" />

      {indicators.map((ind, i) => {
        const p = polar(labelRadius, i);
        const a = angle(i);
        let anchor: 'start' | 'middle' | 'end' = 'middle';
        if (Math.cos(a) > 0.2) anchor = 'start';
        else if (Math.cos(a) < -0.2) anchor = 'end';

        // Word-wrap: split into lines of ≤10 chars at word boundaries
        const words = ind.label.split(' ');
        const lines: string[] = [];
        let current = '';
        for (const word of words) {
          if (!current) { current = word; }
          else if ((current + ' ' + word).length <= 10) { current += ' ' + word; }
          else { lines.push(current); current = word; }
        }
        if (current) lines.push(current);

        const lineHeight = 11;
        const startY = p.y + 4 - ((lines.length - 1) * lineHeight) / 2;

        return lines.map((line, li) => (
          <SvgText
            key={`${ind.key}-${li}`}
            x={p.x}
            y={startY + li * lineHeight}
            fontSize={10}
            fill="#64748B"
            textAnchor={anchor}
          >
            {line}
          </SvgText>
        ));
      })}
    </Svg>
  );
};

// ─── Score input row ──────────────────────────────────────────────────────────

const ScoreRow: React.FC<{
  indicator: TrainingIndicator;
  value: number;
  onChange: (v: number) => void;
}> = ({ indicator, value, onChange }) => {
  const theme = useTheme();
  const question = AXIS_QUESTIONS[indicator.key];
  return (
    <View style={{ paddingVertical: 8 }}>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: question ? 2 : 8 }}>
        {indicator.label}
      </Text>
      {question && (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
          {question}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <TouchableRipple key={i} onPress={() => onChange(i)} borderless style={{ borderRadius: 16 }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: i <= value ? '#3B82F6' : '#CBD5E1',
                backgroundColor: i <= value ? '#3B82F620' : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="labelSmall" style={{ color: i <= value ? '#3B82F6' : '#94A3B8', fontWeight: '700', fontSize: 10 }}>
                {i}
              </Text>
            </View>
          </TouchableRipple>
        ))}
      </View>
    </View>
  );
};

// ─── Check-in history row ─────────────────────────────────────────────────────

const CheckinHistoryRow: React.FC<{
  checkin: TrainingCheckin;
  indicators: TrainingIndicator[];
}> = ({ checkin, indicators }) => {
  const theme = useTheme();
  const date = checkin.taken_at?.toDate
    ? checkin.taken_at.toDate()
    : new Date(checkin.taken_at);
  const dateStr = date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

  const abbreviated = indicators
    .map(ind => {
      const abbr = ind.label[0].toUpperCase() + ind.label[1].toLowerCase();
      const val = checkin.scores[ind.key] ?? '-';
      return `${abbr} ${val}`;
    })
    .join('  ·  ');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.outlineVariant,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
          {dateStr}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {abbreviated}
        </Text>
      </View>
      {checkin.profile_key && checkin.profile_key !== 'default' && (
        <Chip
          compact
          style={{
            backgroundColor: PROFILE_DISPLAY[checkin.profile_key].color + '20',
            height: 24,
            marginRight: 6,
          }}
          textStyle={{ fontSize: 10, color: PROFILE_DISPLAY[checkin.profile_key].color, marginVertical: 0 }}
        >
          {PROFILE_DISPLAY[checkin.profile_key].label}
        </Chip>
      )}
      <Chip
        compact
        style={{
          backgroundColor: checkin.filled_by === 'coach' ? '#7C3AED20' : '#3B82F620',
          height: 24,
        }}
        textStyle={{
          fontSize: 10,
          color: checkin.filled_by === 'coach' ? '#7C3AED' : '#3B82F6',
          marginVertical: 0,
        }}
      >
        {checkin.filled_by === 'coach' ? 'Coach' : 'Self'}
      </Chip>
    </View>
  );
};

// ─── Training Check-in Modal ──────────────────────────────────────────────────

type TrainingContextValue = 'self' | '1to1';

interface CheckinModalProps {
  visible: boolean;
  indicators: TrainingIndicator[];
  onDismiss: () => void;
  onSubmit: (scores: Record<string, number>, notes: string, context: TrainingContextValue) => Promise<void>;
}

const TrainingCheckinModal: React.FC<CheckinModalProps> = ({ visible, indicators, onDismiss, onSubmit }) => {
  const theme = useTheme();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [context, setContext] = useState<TrainingContextValue>('self');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      const initial: Record<string, number> = {};
      indicators.forEach(ind => (initial[ind.key] = 3));
      setScores(initial);
      setNotes('');
      setContext('self');
    }
  }, [visible, indicators]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(scores, notes.trim(), context);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={{
          backgroundColor: theme.colors.surface,
          margin: 20,
          borderRadius: 16,
          padding: 20,
          maxHeight: '90%',
        }}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text variant="titleMedium" style={{ fontWeight: '700', marginBottom: 16 }}>
            Rate my training
          </Text>

          {indicators.map(ind => (
            <ScoreRow
              key={ind.key}
              indicator={ind}
              value={scores[ind.key] ?? 3}
              onChange={v => setScores(prev => ({ ...prev, [ind.key]: v }))}
            />
          ))}

          <TextInput
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={2}
            mode="outlined"
            style={{ backgroundColor: theme.colors.surface, marginTop: 12 }}
          />

          <View style={{ marginTop: 12 }}>
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
              Context
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip selected={context === 'self'} onPress={() => setContext('self')}>
                Self check
              </Chip>
              <Chip selected={context === '1to1'} onPress={() => setContext('1to1')}>
                1-to-1 with coach
              </Chip>
            </View>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onPress={onDismiss} disabled={submitting}>Cancel</Button>
            <Button mode="contained" onPress={handleSubmit} loading={submitting} disabled={submitting}>
              Save
            </Button>
          </View>
        </ScrollView>
      </Modal>
    </Portal>
  );
};

// ─── Trend chart ─────────────────────────────────────────────────────────────

const CHART_COLORS = ['#3B82F6', '#F97316', '#8B5CF6', '#22C55E', '#EAB308', '#EF4444', '#06B6D4'];

const TrendChart: React.FC<{ checkins: TrainingCheckin[]; indicators: TrainingIndicator[] }> = ({
  checkins,
  indicators,
}) => {
  const theme = useTheme();
  const data = [...checkins].filter(c => c.filled_by === 'student').reverse();

  if (data.length < 2) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 32 }}>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
          Rate yourself at least twice to see trends.
        </Text>
      </View>
    );
  }

  const W = 300;
  const H = 160;
  const padL = 20;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xPos = (i: number) =>
    padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const yPos = (score: number) =>
    padT + plotH - ((Math.min(Math.max(score, 1), 5) - 1) / 4) * plotH;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={W} height={H}>
        {[1, 2, 3, 4, 5].map(v => (
          <React.Fragment key={v}>
            <Line
              x1={padL} y1={yPos(v)} x2={W - padR} y2={yPos(v)}
              stroke="#E2E8F0" strokeWidth={v === 3 ? 1 : 0.5}
            />
            <SvgText x={padL - 4} y={yPos(v) + 3} fontSize={8} fill="#94A3B8" textAnchor="end">
              {v}
            </SvgText>
          </React.Fragment>
        ))}

        {indicators.map((ind, idx) => {
          const color = CHART_COLORS[idx % CHART_COLORS.length];
          const points = data.map((c, i) => `${xPos(i)},${yPos(c.scores[ind.key] ?? 3)}`).join(' ');
          return (
            <React.Fragment key={ind.key}>
              <Polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((c, i) => (
                <Circle
                  key={i}
                  cx={xPos(i)}
                  cy={yPos(c.scores[ind.key] ?? 3)}
                  r={2.5}
                  fill={color}
                />
              ))}
            </React.Fragment>
          );
        })}

        {data.map((c, i) => {
          const show = data.length <= 5 || i === 0 || i === data.length - 1 || i === Math.floor((data.length - 1) / 2);
          if (!show) return null;
          const date = c.taken_at?.toDate ? c.taken_at.toDate() : new Date(c.taken_at);
          const label = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
          const anchor: 'start' | 'middle' | 'end' = i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle';
          return (
            <SvgText key={i} x={xPos(i)} y={H - 4} fontSize={8} fill="#94A3B8" textAnchor={anchor}>
              {label}
            </SvgText>
          );
        })}
      </Svg>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 8 }}>
        {indicators.map((ind, idx) => (
          <View key={ind.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 12, height: 2.5, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length], borderRadius: 2 }} />
            <Text variant="labelSmall" style={{ fontSize: 9, color: '#64748B' }}>{ind.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

// ─── TrainingProfileSection ───────────────────────────────────────────────────

export const TrainingProfileSection: React.FC<Props> = ({ contactId, teamId }) => {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  // Fill card width: screenWidth minus 20px outer scroll padding each side, then bleed through the 16px card padding
  const chartSize = screenWidth - 40;
  const [checkins, setCheckins] = useState<TrainingCheckin[]>([]);
  const [indicators, setIndicators] = useState<TrainingIndicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'history'>('profile');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [data, inds] = await Promise.all([
        FirestoreService.getTrainingCheckins(contactId, 10),
        teamId ? FirestoreService.getTeamTrainingIndicators(teamId) : Promise.resolve([]),
      ]);
      setCheckins(data);
      setIndicators(inds);
    } finally {
      setLoading(false);
    }
  }, [contactId, teamId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (scores: Record<string, number>, notes: string, context: TrainingContextValue) => {
    await FirestoreService.addTrainingCheckin(contactId, {
      taken_at: Timestamp.now(),
      filled_by: 'student',
      scores,
      notes: notes || null,
      context,
    });
    setShowModal(false);
    await loadData();
  };

  const latestStudentCheckin = checkins.find(s => s.filled_by === 'student');

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const latestCoachCheckin = checkins.find(s => {
    if (s.filled_by !== 'coach') return false;
    const d = s.taken_at?.toDate ? s.taken_at.toDate() : new Date(s.taken_at);
    return d >= sevenDaysAgo;
  });

  const profileKey = latestStudentCheckin?.profile_key;
  const profileDisplay = profileKey ? PROFILE_DISPLAY[profileKey] : null;

  const tabStyle = (active: boolean) => ({
    paddingHorizontal: 16 as const,
    paddingVertical: 6 as const,
    borderRadius: 8 as const,
    borderWidth: 1 as const,
    borderColor: 'transparent' as const,
    ...(active ? {
      backgroundColor: theme.colors.surface,
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    } : {}),
  });

  return (
    <View style={{ marginBottom: 16 }}>
      {/* Section heading with tab switcher */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 4 }}>
        <Text variant="titleLarge" style={{ fontWeight: '800', color: theme.colors.onSurface }}>
          Training Profile
        </Text>
        <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surfaceVariant, borderRadius: 12, padding: 4 }}>
          <TouchableOpacity onPress={() => setActiveTab('profile')} style={tabStyle(activeTab === 'profile')}>
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.5, color: activeTab === 'profile' ? theme.colors.primary : theme.colors.onSurfaceVariant }}>
              PROFILE
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('history')} style={tabStyle(activeTab === 'history')}>
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.5, color: activeTab === 'history' ? theme.colors.primary : theme.colors.onSurfaceVariant }}>
              HISTORY
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Surface style={{ borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.surface }} elevation={1}>
        <View style={{ padding: 16 }}>
          {loading ? (
            <ActivityIndicator size="small" style={{ marginVertical: 24 }} />
          ) : activeTab === 'profile' ? (
            <>
              {latestStudentCheckin && indicators.length >= 3 ? (
                <View style={{ marginHorizontal: -8, marginTop: -4, marginBottom: 8 }}>
                  <RadarChartSVG
                    indicators={indicators}
                    studentScores={latestStudentCheckin.scores}
                    coachScores={latestCoachCheckin?.scores}
                    size={chartSize + 8}
                    maxValue={5}
                  />
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 28, gap: 6 }}>
                  <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', textAlign: 'center' }}>
                    How is your training going?
                  </Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                    Rate yourself across five dimensions and start building your profile.
                  </Text>
                </View>
              )}

              {profileDisplay && profileKey && (
                <View style={{ borderRadius: 10, padding: 12, backgroundColor: profileDisplay.color + '18', marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: profileDisplay.color }} />
                    <Text variant="labelMedium" style={{ color: profileDisplay.color, fontWeight: '700' }}>
                      {profileDisplay.label}
                    </Text>
                  </View>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {profileDisplay.message(latestStudentCheckin?.primary_lever, latestStudentCheckin?.anchor)}
                  </Text>
                </View>
              )}

              <Button mode="contained-tonal" icon="plus" compact onPress={() => setShowModal(true)} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                Rate myself
              </Button>
            </>
          ) : (
            <>
              <TrendChart checkins={checkins} indicators={indicators} />
              {checkins.length > 0 && (
                <ScrollView style={{ maxHeight: 260, marginTop: 16 }} nestedScrollEnabled>
                  {checkins.map(c => (
                    <CheckinHistoryRow key={c.id} checkin={c} indicators={indicators} />
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </Surface>

      <TrainingCheckinModal
        visible={showModal}
        indicators={indicators}
        onDismiss={() => setShowModal(false)}
        onSubmit={handleSubmit}
      />
    </View>
  );
};
