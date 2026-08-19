/**
 * Renames the one field every hmd-lineup `activity_log` writer uses that
 * Linyup's reader does not.
 *
 * ── THE BUG THIS RENAMES ────────────────────────────────────────────────────
 * Every hmd-lineup `logActivity(...)` call site — trackContacts/index.js,
 * trackBookings/index.js, trackSessionParticipants/index.js,
 * trackEventAttendees/index.js, verifyMembershipCode/index.js,
 * dailyTasks/tasks/anonymizeDeletedContacts.js, and both
 * dailyTasks/tasks/send*AutomationEmails.js — stamps the entry's timestamp
 * field as `date` (`admin.firestore.FieldValue.serverTimestamp()`), never
 * `created_at`. Linyup's `ActivityLogEntry` (packages/shared/src/types/
 * activityLog.ts) requires `created_at`, and its one reader —
 * useContactActivityLog in apps/web/src/app/[locale]/(auth)/contacts/[id]/
 * page.tsx:585-608 — both orders (`orderBy('created_at', 'desc')`) and, for
 * the day-limited view, filters (`where('created_at', '>=', …)`) on it.
 * Firestore's orderBy/where silently EXCLUDE any doc missing the field being
 * ordered/filtered on, so a raw copy makes a migrated contact's entire
 * historical activity feed invisible — not an error, just an empty tab.
 *
 * `event` and `refs.{contact,session,user}` are written under the same
 * names and shapes on both sides (confirmed against trackContacts.js,
 * trackBookings.js, trackEventAttendees.js) — not touched here. An `event`
 * value with no entry in the reader's EVENT_META map (e.g. hmd-lineup's
 * `event_checkin_add`/`event_checkin_delete`) already renders with a
 * graceful fallback icon (page.tsx:3377), so it is not a break worth a
 * mapping decision.
 */

export function transformActivityLogEntry(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  if ('date' in out && !('created_at' in out)) {
    out.created_at = out.date
    delete out.date
  }

  return out
}
