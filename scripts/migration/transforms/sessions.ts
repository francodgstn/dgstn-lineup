export function transformSession(
  src: Record<string, unknown>,
  activityMap: Map<string, { name: string; type: string }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  // Field renames
  if ('activity_id' in out) { out.activityId = out.activity_id; delete out.activity_id }
  delete out.portal_bookings_count  // managed by triggers in new system

  // Enrich with activity name/type
  const actId = out.activityId as string | undefined
  const act   = actId ? activityMap.get(actId) : undefined
  out.activityName = act?.name ?? null
  out.activityType = act?.type ?? 'group_class'

  // New fields
  out.allowBooking = !!(src.portal_bookings_count ?? false)
  out.createdBy    = out.createdBy ?? null

  return out
}

export function transformParticipant(
  docId: string,
  src: Record<string, unknown>,
  teamId: string,
): Record<string, unknown> {
  return {
    contactId:      docId,   // participant doc ID is the contactId in old system
    teamId,
    checked_in_at:  src.checked_in_at  ?? null,
    checked_in_by:  null,
    created_at:     src.created_at     ?? null,
    // attended boolean dropped — attendance implied by presence
  }
}

export function transformBooking(
  docId: string,
  src: Record<string, unknown>,
  teamId: string,
): Record<string, unknown> {
  return {
    ...src,
    id:             docId,
    contact:        null,   // old bookings not always linked to a contact doc
    teamId,
    is_new_contact: true,   // safe default — old bookings were always trial/new
    joinedAt:       src.created_at ?? null,
    booking_token:  null,
  }
}
