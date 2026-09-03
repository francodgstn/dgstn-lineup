// The shape of what `sendContactVerificationCode` tells an ANONYMOUS caller,
// lifted out so the property that matters can be pinned by a test: the caller
// has proven nothing about the email yet, so the response carries only what the
// "which account?" picker renders — first name, last name, team — and never
// PII. `phone`, `birthdate` and `gender` used to be here and were returned to
// anyone who typed a shared address.

export interface MatchedContactSummary {
  id: string
  firstname: string
  lastname: string
  teamId: string | null
}

/** The ONLY projection of a contact document that may leave the callable
 *  before the code is verified. Add a field here only if the picker needs it. */
export function toMatchedContactSummary(
  id: string,
  data: Record<string, unknown>
): MatchedContactSummary {
  return {
    id,
    firstname: typeof data.firstname === 'string' ? data.firstname : '',
    lastname: typeof data.lastname === 'string' ? data.lastname : '',
    teamId: typeof data.teamId === 'string' && data.teamId.length > 0 ? data.teamId : null,
  }
}

export function distinctTeamIds(
  contacts: Array<{ teamId: string | null }>,
  requestedTeamId: string | null
): {
  /** Teams the matched contacts belong to, first-seen order. */
  matchedTeamIds: string[]
  /** Those plus the requested team — every team whose name is needed. */
  allTeamIds: string[]
} {
  const matchedTeamIds = [...new Set(contacts.map((c) => c.teamId).filter((t): t is string => !!t))]
  const allTeamIds = [
    ...new Set([...matchedTeamIds, ...(requestedTeamId ? [requestedTeamId] : [])]),
  ]
  return { matchedTeamIds, allTeamIds }
}

export interface CodeRequestSummary {
  contactsWithTeamName: Array<MatchedContactSummary & { teamName: string | null }>
  /** Every team a name was found for, or null when there is none at all. */
  teamSummaries: Array<{ id: string; name: string }> | null
  /** The studio the OTP email is branded for: the requested team, else the
   *  single matched team, else the platform. */
  teamName: string
}

export function summarizeCodeRequest(input: {
  matched: MatchedContactSummary[]
  requestedTeamId: string | null
  /** Names for every id in `allTeamIds` that exists — an id absent here is a
   *  team that no longer exists and is left out of the summaries. */
  teamNames: Record<string, string>
  platformName?: string
}): CodeRequestSummary {
  const { matched, requestedTeamId, teamNames } = input
  const platformName = input.platformName ?? 'Linyup'
  const { matchedTeamIds, allTeamIds } = distinctTeamIds(matched, requestedTeamId)

  const contactsWithTeamName = matched.map((c) => ({
    ...c,
    teamName: c.teamId ? (teamNames[c.teamId] ?? null) : null,
  }))

  const teamSummaries = allTeamIds.length
    ? allTeamIds.filter((id) => teamNames[id]).map((id) => ({ id, name: teamNames[id] }))
    : null

  let teamName = platformName
  if (requestedTeamId && teamNames[requestedTeamId]) teamName = teamNames[requestedTeamId]
  else if (!requestedTeamId && matchedTeamIds.length === 1 && teamNames[matchedTeamIds[0]]) {
    teamName = teamNames[matchedTeamIds[0]]
  }

  return { contactsWithTeamName, teamSummaries, teamName }
}
