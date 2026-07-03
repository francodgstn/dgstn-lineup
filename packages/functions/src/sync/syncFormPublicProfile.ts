// Keeps forms/{formId}/public_profile/{formId} in sync — a world-readable summary
// the public form page renders from (the public route never reads the root
// `forms` collection). Mirrors syncCoursePublicProfile.
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { touchTeamForSurfaceRecompute } from '../utils/plugins'

// A form counts toward the team's Forms surface when it's published and not
// archived — mirror the public_profile write/delete gate below.
const isLiveForm = (d?: Record<string, unknown>): boolean =>
  !!d && d.status === 'published' && d.archived_at == null

export const syncFormPublicProfile = onDocumentWritten('forms/{formId}', async (event) => {
  const { formId } = event.params
  const afterRef = event.data!.after.ref
  const beforeData = event.data!.before.data()
  const afterData = event.data!.after.data()

  // Remove the public profile when the form is deleted, not published, or archived.
  if (
    !event.data!.after.exists ||
    afterData?.status !== 'published' ||
    afterData?.archived_at != null
  ) {
    await afterRef.collection('public_profile').doc(formId).delete()
  } else {
    const data = afterData!

    const publicProfile = {
      type: 'form',
      teamId: data.teamId,
      slug: data.slug,
      title: data.title,
      description: data.description || '',
      access: data.access ?? 'public',
      // Fields are needed to render the public form. They contain no PII.
      fields: data.fields ?? [],
    }

    await afterRef.collection('public_profile').doc(formId).set(publicProfile)
  }

  // A form crossing the published/archived boundary may flip whether the team's
  // Forms surface is live — nudge the team doc so the surface recompute runs.
  if (isLiveForm(beforeData) !== isLiveForm(afterData)) {
    const teamId = (afterData?.teamId ?? beforeData?.teamId) as string | undefined
    if (teamId) await touchTeamForSurfaceRecompute(teamId)
  }
})
