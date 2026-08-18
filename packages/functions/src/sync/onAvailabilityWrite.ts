// A provider's published hours are half of what makes the appointment picker
// live — and the flag that says so is computed by the TEAM-document sync.
//
// `active_public_surfaces.appointments` (see its doc comment in
// packages/shared/src/types/team.ts) answers "is there anything bookable behind
// /public/{slug}/appointments?", from active availability windows × the
// appointment activities they link to. Publishing, pausing, archiving or
// deleting a window changes that answer and writes nothing to `teams/{teamId}`,
// so `syncTeamPublicProfile` would never re-run and the studio's public-pages
// hub would keep showing yesterday's state.
//
// This is the same one-line nudge the forms / courses / documents syncs already
// use (`touchTeamForSurfaceRecompute`) — a server-timestamp write on a field
// nothing reads, whose only job is to fire that trigger. It cannot loop: the
// team sync writes public_profile and never an availability document.
//
// Narrowed to the fields the flag actually depends on, because a window is also
// edited for its times, buffer and title several times a session and none of
// those can change whether the surface is live.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { AVAILABILITY_COLLECTION } from '@linyup/shared'
import { touchTeamForSurfaceRecompute } from '../utils/plugins'

/** Did this write change anything `appointmentContentExists` reads? */
function liveness(data: FirebaseFirestore.DocumentData | undefined): string | null {
  if (!data) return null
  const ids = [...((data.activityIds ?? []) as string[])].sort().join(',')
  return `${data.status ?? ''}|${ids}`
}

export const onAvailabilityWrite = onDocumentWritten(
  `${AVAILABILITY_COLLECTION}/{availabilityId}`,
  async (event) => {
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    const teamId = (after?.teamId ?? before?.teamId) as string | undefined
    if (!teamId) return
    if (liveness(before) === liveness(after)) return
    await touchTeamForSurfaceRecompute(teamId)
  }
)
