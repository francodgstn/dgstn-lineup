// Keeps teams/{teamId}/public_profile/{teamId} in sync when a team document changes
import { onDocumentWritten } from 'firebase-functions/v2/firestore'

export const syncTeamPublicProfile = onDocumentWritten('teams/{teamId}', async (event) => {
  const { teamId } = event.params
  const afterRef = event.data!.after.ref

  if (!event.data!.after.exists) {
    await afterRef.collection('public_profile').doc(teamId).delete()
    return
  }

  const data = event.data!.after.data()!

  const publicProfile = {
    type: 'team',
    name: data.name || '',
    description: data.description || '',
    slug: data.slug || '',
    sport_type: data.sport_type || null,
    profileImage: data.profileImage || null,
    heroImage: data.heroImage || null,
    bioLinkTheme: data.bioLinkTheme || 'light',
    bioLinkAccentColor: data.bioLinkAccentColor || null,
    bioLinkBackground: data.bioLinkBackground || null,
    socialLinks: (data.socialLinks || []).map((s: Record<string, unknown>) => ({
      platform: s.platform,
      url: s.url,
    })),
    links: (data.links || []).map((link: Record<string, unknown>) => ({
      label: link.label,
      description: link.description || null,
      url: link.url || null,
      iconName: link.iconName || null,
      showInBioLink: link.showInBioLink !== false,
      isBookingLink: link.isBookingLink || false,
      isMembershipLink: link.isMembershipLink || false,
    })),
    membershipRequiredFields: data.membershipRequiredFields || null,
    membershipOptionalFields: data.membershipOptionalFields || null,
    referralEnabled: !!data.settings?.referral?.enabled,
    // Free-plan bio-links carry a "Powered by Linyup" badge. Denormalized here
    // because bio-link pages only ever read public_profile, never teams/.
    showBranding: (data.plan ?? 'free') === 'free',
    updated_at: event.data!.after.updateTime,
  }

  await afterRef.collection('public_profile').doc(teamId).set(publicProfile)
})
