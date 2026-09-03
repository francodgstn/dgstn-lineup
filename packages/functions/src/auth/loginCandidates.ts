// The contact-matching half of `loginContactWithCode`, lifted out so it can be
// tested without a Firestore: WHICH contacts a verified email may sign in as.
//
// Two sources feed it and they are not symmetric: the PRIMARY query matches
// `contacts.email` (the person themself), the ALLOW-LIST query matches
// `contacts.login_emails` (a parent signing in to a child's profile, a shared
// family address). A contact can appear in both — same person, primary email
// also listed — and must come out once. Order is kept as given: primary first,
// so a single-contact login picks the person's own record over a child's.
//
// Scope: when the code was requested FOR a team (`team_id` on the code doc),
// only that team's contacts qualify. When it was not (the mobile flow, no
// studio chosen up front), every team qualifies, optionally narrowed to the
// `teamIds` the code doc recorded at request time. Archived and deleted
// contacts never qualify.

export interface LoginCandidate {
  id: string
  teamId: string | null | undefined
  archived_at?: unknown
  deleted_at?: unknown
}

export interface LoginScope {
  /** The team the code was requested for, or null for a cross-team code. */
  teamId: string | null
  /** For a cross-team code: the teams recorded on it, or null for no narrowing. */
  allowedTeamIds: string[] | null
}

/** The narrowing list applies ONLY to a cross-team code — a team-scoped code
 *  already names its one team, and an empty recorded list means "no
 *  narrowing", never "no team qualifies". */
export function resolveAllowedTeamIds(
  teamId: string | null,
  codeTeamIds: unknown
): string[] | null {
  if (teamId) return null
  if (!Array.isArray(codeTeamIds) || codeTeamIds.length === 0) return null
  const ids = codeTeamIds.filter((t): t is string => typeof t === 'string' && t.length > 0)
  return ids.length ? ids : null
}

export function selectLoginCandidates<T extends LoginCandidate>(
  primary: T[],
  byLoginEmail: T[],
  scope: LoginScope
): T[] {
  const byId = new Map<string, T>()
  for (const c of [...primary, ...byLoginEmail]) {
    if (byId.has(c.id)) continue
    if (scope.teamId && c.teamId !== scope.teamId) continue
    if (scope.allowedTeamIds && (!c.teamId || !scope.allowedTeamIds.includes(c.teamId))) continue
    if (c.archived_at != null || c.deleted_at != null) continue
    byId.set(c.id, c)
  }
  return [...byId.values()]
}
