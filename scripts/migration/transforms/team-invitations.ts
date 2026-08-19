/**
 * Renames the three fields Linyup's team-invitation callables actually read,
 * which hmd-lineup wrote under different names — confirmed against both
 * sides' source, not a guess.
 *
 * ── THE BUG THIS RENAMES ────────────────────────────────────────────────────
 * hmd-lineup's sendTeamInvitation writes `{ email, role, token, status,
 * message, sentAt, sentBy, sentByName, expiresAt, teamId, teamName }`
 * (hmd-lineup/functions/src/sendTeamInvitation/index.js:202-214). Linyup's
 * port (packages/functions/src/teams/sendTeamInvitation.ts:75-86) writes
 * `{ teamId, email, role, token, status, invitedBy, created, expires_at }` —
 * same concepts, three different field names. Every reader uses the NEW
 * names only, so a raw copy leaves them silently absent:
 *
 *   - Settings → Members list orders `orderBy('created', 'desc')`
 *     (apps/web/src/app/[locale]/(auth)/settings/members/page.tsx:429).
 *     Firestore's orderBy excludes any doc missing the ordered field, so a
 *     migrated pending invitation — which has `sentAt`, never `created` —
 *     never appears in the list at all. Silent, not an error.
 *   - acceptTeamInvitation reads `invitation.expires_at` to refuse an
 *     expired link (packages/functions/src/teams/acceptTeamInvitation.ts:20)
 *     and `invitation.invitedBy` to pass straight into `addTeamMember`'s
 *     `addedBy` parameter (line 35 → utils/teams.ts:264, `.set({ …, addedBy
 *     })`). A migrated doc has neither: `expires_at` is undefined so the
 *     comparison `undefined < new Date()` is always false (the invite can
 *     never be flagged expired — fails OPEN), and `addedBy: undefined` is
 *     rejected by the Admin SDK's default `.set()` (no
 *     `ignoreUndefinedProperties` is configured anywhere in
 *     packages/functions) — so accepting a migrated invitation throws an
 *     uncaught internal error instead of completing.
 *   - getTeamInvitationDetails has the same `expires_at` read
 *     (packages/functions/src/teams/getTeamInvitationDetails.ts:14).
 *
 * `status` is written under the same name on both sides (`'pending'`, read
 * by manageTeamInvitation.ts:52) — not renamed here.
 *
 * `sentByName`, `teamName`, `message` have no Linyup reader; left in place
 * (harmless, matches this migration's general policy of not inventing drops
 * for fields nothing reads).
 */

export function transformTeamInvitation(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  if ('sentAt' in out) { out.created = out.sentAt; delete out.sentAt }
  if ('sentBy' in out) { out.invitedBy = out.sentBy; delete out.sentBy }
  if ('expiresAt' in out) { out.expires_at = out.expiresAt; delete out.expiresAt }

  return out
}
