/**
 * Determines whether a checkin is confirmed based on event type and the data
 * collected during the checkin flow.
 *
 * This runs on both client (UI indicators) and server (Cloud Function validation)
 * so the logic must not import any browser or Node-only APIs.
 *
 * Confirmation rules per built-in event type:
 *   exam:    requires at least one ranking-system entry in checkin_data.disciplines
 *   camp:    requires checkin_data.join_as
 *   others:  auto-confirmed unless checkin_data.categories exists (plugin types
 *            like fighting_cup use a categories array that must be non-empty)
 */
export function isCheckinCompleted(
  eventType: string,
  checkinData?: Record<string, unknown>,
): boolean {
  switch (eventType) {
    case 'exam': {
      const disciplines = checkinData?.disciplines as Record<string, number> | undefined
      return !!disciplines && Object.values(disciplines).some((v) => (v ?? 0) > 0)
    }
    case 'camp':
      return typeof checkinData?.join_as === 'string' && checkinData.join_as.length > 0
    default:
      // Plugin/custom types that rely on a categories array (e.g. fighting_cup)
      if (Array.isArray(checkinData?.categories)) {
        return (checkinData!.categories as unknown[]).length > 0
      }
      // competition, seminar, workshop, and any other type: auto-confirm
      return true
  }
}
