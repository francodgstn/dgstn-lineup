import { AffiliationSummary, ContactResidence, AffiliationStatus, Contact, RankingSystem } from '../types';

/**
 * @deprecated HMD's belt scale, hardcoded.
 *
 * It is NOT the source of truth and must not be used for a migrated contact:
 * ranking systems are tenant configuration (`RankingSystem` on the team, or on
 * the organisation when it has any), HMD is about to insert two new belts into
 * its own scale, and this table is one of three hand-maintained copies of it.
 *
 * It survives for exactly one case — a contact still carrying the pre-migration
 * scalar `rank` with no configured systems to resolve against — and that case
 * disappears with the migration. Read through `resolvePrimaryRank` instead,
 * which reaches this only as a last resort.
 */
export const RANKS = [
  { rank: 0, belt: 'No belt', badgeColor: '#AAAAAA' },
  { rank: 1, belt: 'White', badgeColor: '#DDDDDD' },
  { rank: 2, belt: 'Yellow', badgeColor: '#FFDC00' },
  { rank: 3, belt: 'Orange', badgeColor: '#FF851B' },
  { rank: 4, belt: 'Orange/Green', badgeColor: '#FF851B', secondColor: '#1c9c2b' },
  { rank: 5, belt: 'Green', badgeColor: '#1c9c2b' },
  { rank: 6, belt: 'Green/Blue', badgeColor: '#1c9c2b', secondColor: '#0074D9' },
  { rank: 7, belt: 'Blue', badgeColor: '#0074D9' },
  { rank: 8, belt: 'Blue/Red', badgeColor: '#0074D9', secondColor: '#d41010' },
  { rank: 9, belt: 'Red', badgeColor: '#d41010' },
  { rank: 10, belt: 'Red/Black', badgeColor: '#d41010', secondColor: '#111111' },
  { rank: 11, belt: 'Black I Dan', badgeColor: '#111111' },
  { rank: 12, belt: 'Black II Dan', badgeColor: '#111111' },
  { rank: 13, belt: 'Black III Dan', badgeColor: '#111111' },
  { rank: 14, belt: 'Master', badgeColor: '#111111' },
];

/** @deprecated Resolves against the hardcoded HMD table — see RANKS. */
export const getRankInfo = (rank?: number) => {
  if (rank == null) return null;
  return RANKS.find((r) => r.rank === rank) || null;
};

/** What the badge needs to draw a level, whatever scale it came from. */
export interface ResolvedRank {
  system: RankingSystem | null;
  value: number;
  label: string;
  color: string;
  secondColor?: string;
}

/**
 * THE contact's belt — resolved against the tenant's CONFIGURED ranking systems.
 *
 * This app read `contact.rank`, a scalar the HMD migration deletes, so every
 * migrated member's profile rendered "NO BELT". The stored fact is
 * `contact.ranks`, keyed by ranking-system id.
 *
 * Returns null when there is nothing to show — no systems configured, or no
 * level recorded — and callers must hide the belt rather than invent a default.
 * A tenant that does not use ranks should not be shown an empty one.
 */
export function resolvePrimaryRank(
  contact: Pick<Contact, 'ranks' | 'rank'>,
  systems: RankingSystem[] | undefined | null,
): ResolvedRank | null {
  const list = systems ?? [];
  const system = list.find((s) => s.is_primary) ?? list[0] ?? null;

  if (system) {
    const value = contact.ranks?.[system.id];
    if (value == null) return null;
    const level = (system.levels ?? []).find((l) => l.value === value);
    if (!level) return null; // a level the scale no longer defines
    return {
      system,
      value,
      label: level.label,
      color: level.color ?? '#DDDDDD',
      secondColor: level.secondColor,
    };
  }

  // Last resort: an unmigrated contact with the legacy scalar and no configured
  // systems to read it against. Dies with the migration — see RANKS.
  const legacy = getRankInfo(contact.rank);
  return legacy
    ? {
        system: null,
        value: legacy.rank,
        label: legacy.belt,
        color: legacy.badgeColor,
        secondColor: (legacy as { secondColor?: string }).secondColor,
      }
    : null;
}

// Returns white or black text depending on background luminance
export const contrastTextColor = (hex: string) => {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

// Affiliation status configuration
export const AFFILIATION_STATUS_CONFIG: Record<string, { label: string; description: string; bgColor: string; textColor: string }> = {
  guest: {
    label: 'GUEST',
    description: 'You are registered as a guest. Contact your team to start the affiliation process.',
    bgColor: '#FF9800', // Orange
    textColor: '#FFFFFF',
  },
  requested: {
    label: 'REQUESTED',
    description: 'Your affiliation request has been submitted. Waiting for the Team Manager to forward it.',
    bgColor: '#9E9E9E', // Grey
    textColor: '#FFFFFF',
  },
  being_checked: {
    label: 'BEING CHECKED',
    description: 'The Organization Admin is reviewing your request after the team forwarded it.',
    bgColor: '#2196F3', // Blue
    textColor: '#FFFFFF',
  },
  almost_ready: {
    label: 'ALMOST READY',
    description: 'The Organization Admin has sent your details to the federation and is awaiting approval.',
    bgColor: '#9C27B0', // Purple
    textColor: '#FFFFFF',
  },
  active: {
    label: 'ACTIVE',
    description: 'Your affiliation has been approved by the federation and is now valid.',
    bgColor: '#4CAF50', // Green
    textColor: '#FFFFFF',
  },
  expired: {
    label: 'EXPIRED',
    description: 'Your affiliation has reached its end date or was manually expired. Contact your team to renew.',
    bgColor: '#F44336', // Red
    textColor: '#FFFFFF',
  },
};

// Map affiliation status to display label
export const getStatusLabel = (status?: AffiliationStatus): string => {
  if (!status) return 'MEMBER';
  return AFFILIATION_STATUS_CONFIG[status]?.label || 'MEMBER';
};

// Map affiliation status to badge color
export const getStatusColors = (status?: AffiliationStatus, themeColors?: any): { bg: string; text: string } => {
  if (!status) {
    return { bg: themeColors?.secondaryContainer || '#E8DEF8', text: themeColors?.onSecondaryContainer || '#1D192B' };
  }
  const config = AFFILIATION_STATUS_CONFIG[status];
  if (config) {
    return { bg: config.bgColor, text: config.textColor };
  }
  return { bg: themeColors?.secondaryContainer || '#E8DEF8', text: themeColors?.onSecondaryContainer || '#1D192B' };
};

// Get status description for the info modal
export const getStatusDescription = (status?: AffiliationStatus): string => {
  if (!status) return 'Your affiliation status is not set.';
  return AFFILIATION_STATUS_CONFIG[status]?.description || 'Your affiliation status is not set.';
};

export const formatDateValue = (value: unknown) => {
  if (!value) {
    return null;
  }

  let parsed: Date | null = null;

  if (value instanceof Date) {
    parsed = value;
  } else if (typeof value === 'string') {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      parsed = asDate;
    }
  } else if (typeof value === 'number') {
    parsed = new Date(value);
  } else if (typeof value === 'object' && value !== null) {
    const ref: any = value;
    if (typeof ref.toDate === 'function') {
      parsed = ref.toDate();
    } else if (typeof ref.seconds === 'number') {
      parsed = new Date(ref.seconds * 1000);
    } else if (typeof ref._seconds === 'number') {
      parsed = new Date(ref._seconds * 1000);
    }
  }

  return parsed ? parsed.toLocaleDateString() : null;
};

export const calculateAge = (birthdate: unknown): number | null => {
  let parsed: Date | null = null;

  if (birthdate instanceof Date) {
    parsed = birthdate;
  } else if (typeof birthdate === 'string') {
    const d = new Date(birthdate);
    if (!Number.isNaN(d.getTime())) parsed = d;
  } else if (typeof birthdate === 'number') {
    parsed = new Date(birthdate);
  } else if (typeof birthdate === 'object' && birthdate !== null) {
    const ref: any = birthdate;
    if (typeof ref.toDate === 'function') parsed = ref.toDate();
    else if (typeof ref.seconds === 'number') parsed = new Date(ref.seconds * 1000);
    else if (typeof ref._seconds === 'number') parsed = new Date(ref._seconds * 1000);
  }

  if (!parsed) return null;

  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDiff = today.getMonth() - parsed.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
};

export const formatGender = (gender?: string): string | null => {
  if (!gender) return null;
  if (gender === 'M') return 'M';
  if (gender === 'F') return 'F';
  return gender;
};

export const formatResidence = (residence?: ContactResidence | null) => {
  if (!residence) {
    return null;
  }

  const firstLine = [residence.route, residence.street_number].filter(Boolean).join(' ').trim();
  const secondLine = [residence.postal_code, residence.locality].filter(Boolean).join(' ').trim();
  const thirdLine = [residence.region, residence.country].filter(Boolean).join(' ').trim();

  const lines = [firstLine, secondLine, thirdLine].filter(Boolean);

  return lines.length ? lines.join(',') : null;
};

// ── Affiliation helpers ──────────────────────────────────────────────────────

/** Returns a short display label for the affiliation badge on the card. */
export const getAffiliationLabel = (summary?: AffiliationSummary): string => {
  if (!summary || !summary.has_active) return 'NOT AFFILIATED';
  if (summary.types.length === 1) return summary.types[0].replace(/_/g, ' ').toUpperCase();
  return `AFFILIATED (${summary.types.length})`;
};

/** Returns badge background/text colors for the affiliation badge. */
export const getAffiliationColors = (
  summary?: AffiliationSummary,
  themeColors?: any,
): { bg: string; text: string } => {
  if (summary?.has_active) return { bg: '#4CAF50', text: '#FFFFFF' };
  return {
    bg: themeColors?.surfaceVariant ?? '#E8E8E8',
    text: themeColors?.onSurfaceVariant ?? '#555555',
  };
};
