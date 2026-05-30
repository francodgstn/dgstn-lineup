export function transformSession(
  data:          Record<string, unknown>,
  activityMap:   Map<string, { name: string; type: string }>,
): Record<string, unknown> {
  const { portal_bookings_count, instructor_name, activity_id, ...rest } = data as Record<string, unknown> & {
    portal_bookings_count?: number
    instructor_name?:       string
    activity_id?:           string
  }

  const activityId   = (data.activityId ?? activity_id) as string | undefined
  const activityMeta = activityId ? activityMap.get(activityId) : undefined

  return {
    ...rest,
    activityId,
    activityName: data.activityName ?? activityMeta?.name ?? null,
    activityType: data.activityType ?? activityMeta?.type ?? 'group_class',
    allowBooking: data.allowBooking ?? (portal_bookings_count != null && portal_bookings_count > 0),
    createdBy:    data.createdBy ?? null,
    ...(instructor_name ? { coachName: instructor_name } : {}),
  }
}

export function transformParticipant(
  data:      Record<string, unknown>,
  contactId: string,
  teamId:    string,
): Record<string, unknown> {
  return {
    contactId,
    teamId,
    checked_in_at: data.checked_in_at ?? data.created_at ?? null,
    checked_in_by: data.checked_in_by ?? null,
  }
}

export function transformBooking(
  data:      Record<string, unknown>,
  bookingId: string,
  sessionId: string,
  teamId:    string,
): Record<string, unknown> {
  const { age, age_at_booking, subscription_type_id, updated_at, ...rest } = data as Record<string, unknown>

  return {
    ...rest,
    id:             bookingId,
    teamId,
    contact:        data.contact ?? null,
    session:        sessionId,
    is_new_contact: data.is_new_contact ?? true,
    joinedAt:       data.joinedAt ?? data.created_at ?? null,
    booking_token:  data.booking_token ?? null,
  }
}

export function transformSessionSeries(data: Record<string, unknown>): Record<string, unknown> {
  const rec = data.recurrence as Record<string, unknown> | undefined
  if (!rec) return data

  const transformed = {
    ...data,
    recurrence: {
      ...rec,
      daysOfWeek: rec.daysOfWeek ?? rec.days_of_week,
      duration:   rec.duration   ?? rec.duration_minutes,
      endDate:    rec.endDate    ?? rec.end_date,
      // frequency is the same in both schemas
    },
  }
  // Remove old snake_case keys if they were duplicated
  delete (transformed.recurrence as Record<string, unknown>).days_of_week
  delete (transformed.recurrence as Record<string, unknown>).duration_minutes
  delete (transformed.recurrence as Record<string, unknown>).end_date
  return transformed
}
