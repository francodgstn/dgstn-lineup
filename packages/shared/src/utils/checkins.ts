/**
 * Determines whether a checkin is confirmed based on event type and the data
 * collected during the checkin flow.
 *
 * This runs on both client (UI indicators) and server (Cloud Function validation)
 * so the logic must not import any browser or Node-only APIs.
 *
 * Confirmation rules per built-in event type:
 *   exam:    requires at least one ranking-system entry in checkin_data.disciplines
 *            (an entry whose level is 0 IS a result — see the arm below)
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
      // "Not examined" is the ABSENCE OF THE KEY, never the value zero. Every
      // ranking preset's first level is `value: 0` — BJJ White, the Swiss
      // "Krebs", HMD "No belt" — so the earlier `> 0` test made awarding the
      // entry grade unrecordable: the form wrote the 0 and the check-in stayed
      // pending forever.
      //
      // An empty or absent map still means nobody was examined, which the
      // "admit now, finalise later" door depends on: it asks this with
      // `checkinData = {}` to decide whether there is a second step at all.
      const disciplines = checkinData?.disciplines as Record<string, unknown> | undefined
      if (!disciplines) return false
      return Object.values(disciplines).some(
        (v) => typeof v === 'number' && Number.isFinite(v),
      )
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
