export function transformSession(
  src: Record<string, unknown>,
  activityMap: Map<string, { name: string; type: string }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  // Field renames
  if ('activity_id' in out) { out.activityId = out.activity_id; delete out.activity_id }
  delete out.id                     // let Firestore doc ID be the canonical id; avoid collisions in web app spread
  // portal_bookings_count → bookings_count (pass06 overwrites this with the real subcollection count)
  if (out.bookings_count == null) out.bookings_count = (out.portal_bookings_count as number | undefined) ?? 0
  delete out.portal_bookings_count
  delete out.notes                  // session comments/descriptions excluded from migration

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
  // In hmd-lineup the booking doc ID is the contactId, and the contact field
  // stores the same value. dgstn-lineup queries bookings by contactId, so we
  // need to surface both field names.
  const contactId = (src.contact as string | undefined) ?? docId

  return {
    ...src,
    id:             docId,
    contact:        contactId,
    contactId:      contactId,
    teamId,
    is_new_contact: src.is_new_contact ?? true,
    joinedAt:       src.joinedAt ?? src.created_at ?? null,
    booking_token:  src.booking_token ?? null,
  }
}
