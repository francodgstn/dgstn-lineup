// The team schedule mirror's discriminator — `type: 'session'` for a class,
// `type: 'appointment_session'` for an appointment
// (packages/functions/src/sync/syncSessionPublicProfile.ts). NEVER `doc_type`,
// which nothing writes; a query filtered on it silently matches zero
// documents (see docs/mobile-roadmap-2026-09.md §1.2 — this was a live defect:
// every session/attendance/booking query in this app returned empty).
//
// Kept in its own dependency-free module (no `firebase/*` imports) so it is
// testable without pulling in `services/firestore.ts`'s Firebase app
// initialization side effects.
export const SESSION_MIRROR_TYPE = 'session' as const;
