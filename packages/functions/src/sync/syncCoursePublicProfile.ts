// Keeps courses/{courseId}/public_profile/{courseId} in sync
import { onDocumentWritten } from 'firebase-functions/v2/firestore'


export const syncCoursePublicProfile = onDocumentWritten('courses/{courseId}', async (event) => {
  const { courseId } = event.params
  const afterRef = event.data!.after.ref

  const afterData = event.data!.after.data()

  // Remove public profile when document is deleted, not published, or archived
  if (!event.data!.after.exists || afterData?.status !== 'published' || afterData?.archived_at != null) {
    await afterRef.collection('public_profile').doc(courseId).delete()
    return
  }

  const data = afterData!

  const publicProfile = {
    type: 'course',
    teamId: data.teamId,
    slug: data.slug,
    title: data.title,
    summary: data.summary || '',
    coverImageUrl: data.coverImageUrl || null,
    accessType: data.accessRule?.type ?? 'registered',
    subscriptionTypeIds: data.accessRule?.subscriptionTypeIds ?? [],
    // One-off shop price for 'purchase'-tier courses (major units). null for the
    // free/registered/subscription tiers so the shop can ignore them.
    priceAmount: typeof data.accessRule?.priceAmount === 'number' ? data.accessRule.priceAmount : null,
    moduleCount: data.moduleCount ?? 0,
    lessonCount: data.lessonCount ?? 0,
    order: data.order ?? 0,
  }

  await afterRef.collection('public_profile').doc(courseId).set(publicProfile)
})
