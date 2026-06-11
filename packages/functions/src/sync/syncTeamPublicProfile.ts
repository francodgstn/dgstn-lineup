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
    // Billing currency for the website pricing table (bio-link/website never read teams/).
    default_currency: (data.default_currency as string | undefined) || null,
    updated_at: event.data!.after.updateTime,
  }

  // Merge so sibling syncs that write other public_profile fields with merge
  // (e.g. aggregator_subscription_types, bookingSettings) aren't clobbered by a
  // team-doc write. Every field above is recomputed each run, so merge is safe.
  await afterRef.collection('public_profile').doc(teamId).set(publicProfile, { merge: true })
})
