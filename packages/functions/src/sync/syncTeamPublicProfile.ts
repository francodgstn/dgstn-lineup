// Keeps teams/{teamId}/public_profile/{teamId} in sync when a team document changes
import * as admin from 'firebase-admin'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  SITE_PUBLISHED_COLLECTION,
  COURSES_COLLECTION,
  FORMS_COLLECTION,
  resolveSystemLinkTarget,
} from '@linyup/shared'
import type { PublicSurface, ActivePublicSurfaces } from '@linyup/shared'

export const syncTeamPublicProfile = onDocumentWritten('teams/{teamId}', async (event) => {
  const { teamId } = event.params
  const afterRef = event.data!.after.ref

  if (!event.data!.after.exists) {
    await afterRef.collection('public_profile').doc(teamId).delete()
    return
  }

  const data = event.data!.after.data()!
  const db = admin.firestore()

  // ── active_public_surfaces computation ──────────────────────────────────────
  // Each check uses limit(1) to avoid full scans.

  // site: website plugin active AND a published site exists
  const [websitePluginSnap, sitePublishedSnap] = await Promise.all([
    db
      .doc(
        `${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/website`
      )
      .get(),
    db.doc(`${SITE_PUBLISHED_COLLECTION}/${teamId}`).get(),
  ])
  const siteActive =
    websitePluginSnap.exists &&
    websitePluginSnap.data()?.status === 'active' &&
    sitePublishedSnap.exists

  // Portal (stored under the stable `space` key): the contact portal. Today the
  // published-course library is its ONLY module, so the portal is live when the
  // online-courses plugin is active AND ≥1 published, non-archived course exists.
  // Seam: as the portal grows (bookings, subscriptions, profile), OR each new
  // module's liveness into `spaceActive` below — `space` stays the portal's
  // on/off signal, no longer hard-tied to "has a course".
  const onlineCoursesPluginSnap = await db
    .doc(
      `${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/online-courses`
    )
    .get()
  let portalCoursesLive = false
  if (onlineCoursesPluginSnap.exists && onlineCoursesPluginSnap.data()?.status === 'active') {
    const publishedCourseSnap = await db
      .collection(COURSES_COLLECTION)
      .where('teamId', '==', teamId)
      .where('status', '==', 'published')
      .where('archived_at', '==', null)
      .limit(1)
      .get()
    portalCoursesLive = !publishedCourseSnap.empty
  }
  // OR additional portal-module signals into this as the portal grows.
  const spaceActive = portalCoursesLive

  // forms: custom-forms plugin active AND ≥1 published, non-archived form
  const formsPluginSnap = await db
    .doc(`${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/custom-forms`)
    .get()
  let formsActive = false
  if (formsPluginSnap.exists && formsPluginSnap.data()?.status === 'active') {
    const publishedFormSnap = await db
      .collection(FORMS_COLLECTION)
      .where('teamId', '==', teamId)
      .where('status', '==', 'published')
      .where('archived_at', '==', null)
      .limit(1)
      .get()
    formsActive = !publishedFormSnap.empty
  }

  // booking: base feature — available whenever booking settings have been configured
  // (bookingSettings lands on the public_profile via syncBookingSettings; here we
  // mirror the same signal used elsewhere: the settings sub-doc existence / field).
  // Default to true — booking works on every plan, plugin-free.
  const bookingActive = true

  const active_public_surfaces: ActivePublicSurfaces = {
    site: siteActive,
    space: spaceActive,
    booking: bookingActive,
    forms: formsActive,
  }

  // ── default_public_surface ───────────────────────────────────────────────────
  // Copy only when set (never write undefined to Firestore).
  const defaultSurface = data.default_public_surface as PublicSurface | undefined

  const publicProfile: Record<string, unknown> = {
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
      // 'page link' to one of the team's public surfaces; null for custom links.
      // resolveSystemLinkTarget also maps pre-refactor boolean flags.
      target: resolveSystemLinkTarget(link) || null,
    })),
    membershipRequiredFields: data.membershipRequiredFields || null,
    membershipOptionalFields: data.membershipOptionalFields || null,
    referralEnabled: !!data.settings?.referral?.enabled,
    // Free-plan bio-links carry a "Powered by Linyup" badge. Denormalized here
    // because bio-link pages only ever read public_profile, never teams/.
    showBranding: (data.plan ?? 'free') === 'free',
    // Billing currency for the website pricing table (bio-link/website never read teams/).
    default_currency: (data.default_currency as string | undefined) || null,
    active_public_surfaces,
    updated_at: event.data!.after.updateTime,
  }

  // Only write default_public_surface when explicitly set; omit the key entirely
  // if unset so existing docs with no preference are not polluted with undefined.
  if (defaultSurface !== undefined) {
    publicProfile.default_public_surface = defaultSurface
  }

  // Merge so sibling syncs that write other public_profile fields with merge
  // (e.g. aggregator_subscription_types, bookingSettings) aren't clobbered by a
  // team-doc write. Every field above is recomputed each run, so merge is safe.
  await afterRef.collection('public_profile').doc(teamId).set(publicProfile, { merge: true })
})
