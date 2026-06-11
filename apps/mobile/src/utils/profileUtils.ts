import { ContactResidence, MembershipStatus } from '../types';

// Rank / belt configuration
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

export const getRankInfo = (rank?: number) => {
  if (rank == null) return null;
  return RANKS.find((r) => r.rank === rank) || null;
};

// Returns white or black text depending on background luminance
export const contrastTextColor = (hex: string) => {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
};

// Membership status configuration
export const MEMBERSHIP_STATUS_CONFIG: Record<string, { label: string; description: string; bgColor: string; textColor: string }> = {
  guest: {
    label: 'GUEST',
    description: 'You are registered as a guest. Contact your team to start the membership process.',
    bgColor: '#FF9800', // Orange
    textColor: '#FFFFFF',
  },
  requested: {
    label: 'REQUESTED',
    description: 'Your membership request has been submitted. Waiting for the Team Manager to forward it.',
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
    description: 'Your membership has been approved by the federation and is now valid.',
    bgColor: '#4CAF50', // Green
    textColor: '#FFFFFF',
  },
  expired: {
    label: 'EXPIRED',
    description: 'Your membership has reached its end date or was manually expired. Contact your team to renew.',
    bgColor: '#F44336', // Red
    textColor: '#FFFFFF',
  },
};

// Map membership status to display label
export const getStatusLabel = (status?: MembershipStatus): string => {
  if (!status) return 'MEMBER';
  return MEMBERSHIP_STATUS_CONFIG[status]?.label || 'MEMBER';
};

// Map membership status to badge color
export const getStatusColors = (status?: MembershipStatus, themeColors?: any): { bg: string; text: string } => {
  if (!status) {
    return { bg: themeColors?.secondaryContainer || '#E8DEF8', text: themeColors?.onSecondaryContainer || '#1D192B' };
  }
  const config = MEMBERSHIP_STATUS_CONFIG[status];
  if (config) {
    return { bg: config.bgColor, text: config.textColor };
  }
  return { bg: themeColors?.secondaryContainer || '#E8DEF8', text: themeColors?.onSecondaryContainer || '#1D192B' };
};

// Get status description for the info modal
export const getStatusDescription = (status?: MembershipStatus): string => {
  if (!status) return 'Your membership status is not set.';
  return MEMBERSHIP_STATUS_CONFIG[status]?.description || 'Your membership status is not set.';
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
