// Keeps teams/{teamId}/public_profile/{teamId} in sync when a team document changes
import { regionalFunctions } from '../utils/functions'

export const syncTeamPublicProfile = regionalFunctions.firestore
  .document('teams/{teamId}')
  .onWrite(async (change, context) => {
    const { teamId } = context.params

    // Document deleted — remove public profile
    if (!change.after.exists) {
      await change.after.ref.parent.parent!.collection('public_profile').doc(teamId).delete()
      return
    }

    const data = change.after.data()!

    // Only expose safe fields to the public
    const publicProfile = {
      name: data.name || '',
      description: data.description || '',
      slug: data.slug || '',
      sport_type: data.sport_type || null,
      links: (data.links || []).map((link: Record<string, unknown>) => ({
        label: link.label,
        description: link.description,
        url: link.url,
        showInPortal: link.showInPortal,
        isBookingLink: link.isBookingLink || false,
        isMembershipLink: link.isMembershipLink || false,
      })),
      updated_at: change.after.updateTime,
    }

    await change.after.ref.collection('public_profile').doc(teamId).set(publicProfile)
  })
