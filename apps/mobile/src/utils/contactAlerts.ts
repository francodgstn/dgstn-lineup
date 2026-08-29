// Manual mirror of packages/shared/src/utils/contactAlerts.ts (+ the
// AlertScheduleType union in packages/shared/src/types/contact.ts).
//
// apps/mobile does not depend on @linyup/shared — see the RankingSystem note
// in ../types/index.ts: wiring the workspace package in needs a Metro/
// monorepo module-resolution change of its own, not a bug fix, so this file
// hand-copies the resolver mobile needs. Keep the logic byte-for-byte
// equivalent to the shared source — if it drifts, fix it there and re-copy,
// don't "improve" it here. Behaviour is pinned by
// packages/functions/src/contacts/contactAlerts.test.ts.
//
// ─── TWO DOCUMENT SHAPES, and both are live ──────────────────────────────────
//
// The studio UI and the HMD migration write a FLAT pair:
//     { schedule_type: 'datetime', schedule_value: <Timestamp> }
// `bookSession` and the automation engine write a NESTED map:
//     { schedule: { type: 'datetime', value: <Timestamp> } }
//
// This app used to read the nested shape ONLY, with a `|| 'datetime'`
// fallback — so a studio-authored alert arrived as `datetime` with an
// undefined value, became an Invalid Date, compared false against
// everything, and never appeared. "Show in member app" therefore never
// worked for a hand-written alert. `readAlert()` is the one reader that
// understands both; nothing downstream should ever touch `schedule_value` or
// `schedule` directly.
//
// This app's own fired predicate also disagreed with the studio web app's:
// it read `sessions_countdown`'s value as sessions REMAINING (`value <= 1`)
// instead of a total-sessions target, and it windowed a `datetime` alert to
// ±7 days instead of "fired once the instant has passed, stays fired until
// dismissed". Both are gone below — dismissal is `archived_at`, never the
// passage of time.

import type { Timestamp } from 'firebase/firestore';
import type { AlertScheduleType, ContactAlert } from '../types';

/** Anything Firestore may hand back for an alert, in either shape. */
export interface RawContactAlert {
  id?: string;
  schedule_type?: AlertScheduleType | string | null;
  schedule_value?: number | Timestamp | null;
  schedule?: { type?: AlertScheduleType | string | null; value?: number | Timestamp | null } | null;
  message?: string | null;
  /** Real field on auto-generated alerts (booking / automation /
   *  form_submission / contact_request) — not part of the shared shape, but
   *  live data the mobile UI reads for its icon. Preserved through readAlert(). */
  alert_type?: string | null;
  show_in_app?: boolean | null;
  archived_at?: Timestamp | null;
  created_at?: Timestamp | null;
}

/** The schedule, narrowed — exactly one of `sessions` / `at` is meaningful. */
export interface AlertSchedule {
  type: AlertScheduleType;
  /** `sessions_countdown` only: the total-session count that fires it. */
  sessions: number | null;
  /** `datetime` only: the instant that fires it. */
  at: Date | null;
}

const SCHEDULE_TYPES: readonly AlertScheduleType[] = ['sessions_countdown', 'datetime', 'always'];

function isScheduleType(v: unknown): v is AlertScheduleType {
  return typeof v === 'string' && (SCHEDULE_TYPES as readonly string[]).includes(v);
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object' && typeof (v as Timestamp).toDate === 'function') {
    const d = (v as Timestamp).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  return null;
}

/**
 * Narrow either document shape into one schedule.
 *
 * An unrecognised or absent type falls back to `sessions_countdown`, NOT to
 * `datetime`: a countdown with no value is simply never fired, whereas the
 * old `|| 'datetime'` fallback produced an Invalid Date whose comparisons
 * were all false — the same outcome, reached by an accident. Failing to a
 * kind that cannot fire is the honest version.
 */
export function alertSchedule(raw: RawContactAlert): AlertSchedule {
  const rawType = raw.schedule_type ?? raw.schedule?.type;
  const type: AlertScheduleType = isScheduleType(rawType) ? rawType : 'sessions_countdown';
  const value = raw.schedule_value ?? raw.schedule?.value ?? null;

  if (type === 'always') return { type, sessions: null, at: null };
  if (type === 'datetime') return { type, sessions: null, at: toDate(value) };
  return { type, sessions: typeof value === 'number' ? value : null, at: null };
}

/** Both shapes in, one canonical flat `ContactAlert` out. */
export function readAlert(id: string, raw: RawContactAlert): ContactAlert {
  const schedule = alertSchedule(raw);
  return {
    id,
    schedule_type: schedule.type,
    schedule_value: raw.schedule_value ?? raw.schedule?.value ?? null,
    message: raw.message ?? '',
    alert_type: raw.alert_type ?? undefined,
    show_in_app: raw.show_in_app ?? false,
    archived_at: raw.archived_at ?? null,
    created_at: raw.created_at ?? undefined,
  };
}

export interface AlertFiredContext {
  /** `Contact.total_sessions`. Absent counts as 0. */
  totalSessions?: number | null;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/**
 * Has this alert's trigger passed? THE only implementation.
 *
 * Says nothing about whether it was dismissed — see `alertIsActive`.
 */
export function alertIsFired(raw: RawContactAlert, ctx: AlertFiredContext = {}): boolean {
  const schedule = alertSchedule(raw);
  switch (schedule.type) {
    case 'always':
      return true;
    case 'datetime':
      return schedule.at !== null && schedule.at.getTime() <= (ctx.now ?? new Date()).getTime();
    case 'sessions_countdown':
      return schedule.sessions !== null && (ctx.totalSessions ?? 0) >= schedule.sessions;
  }
}

/**
 * Fired AND not dismissed — what a display surface actually wants to know.
 * Mobile's own query already filters `archived_at == null` server-side, so
 * `getContactAlerts` calls `alertIsFired` directly; this is kept for parity
 * with the shared source and for any future caller that reads unfiltered docs.
 */
export function alertIsActive(raw: RawContactAlert, ctx: AlertFiredContext = {}): boolean {
  return !raw.archived_at && alertIsFired(raw, ctx);
}
