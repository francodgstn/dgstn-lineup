// Keeps teams/{teamId}/public_profile/{teamId} in sync when a team document changes
import * as admin from 'firebase-admin'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  SITE_PUBLISHED_COLLECTION,
  FORMS_COLLECTION,
  DOCUMENTS_COLLECTION,
  resolveSystemLinkTarget,
} from '@linyup/shared'
import type { PublicSurface, ActivePublicSurfaces, DocumentKind } from '@linyup/shared'
import { rebuildTeamPublicCoaches } from './syncTeamCoachesPublicProfile'

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

  // online-courses plugin snapshot — used by the shop capability check below.
  const onlineCoursesPluginSnap = await db
    .doc(
      `${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/online-courses`
    )
    .get()

  // Portal (stored under the stable `space` key): the contact's PERSONAL member
  // portal — membership, bookings, profile, and the courses they can open. Decoupled
  // from the course catalogue (that lives in the shop), so it's a BASE surface,
  // available to every team's contacts → always live, plugin-free.
  const spaceActive = true

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

  // documents: documents plugin active AND ≥1 published, public, non-archived
  // document. Reached via /public/{slug}/documents (discovery signal, not a
  // default redirect target) — same shape as the forms check above.
  const documentsPluginSnap = await db
    .doc(`${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/documents`)
    .get()
  const documentsPluginActive =
    documentsPluginSnap.exists && documentsPluginSnap.data()?.status === 'active'
  let documentsActive = false
  if (documentsPluginActive) {
    const publishedDocSnap = await db
      .collection(DOCUMENTS_COLLECTION)
      .where('teamId', '==', teamId)
      .where('status', '==', 'published')
      .where('isPublic', '==', true)
      .where('archived_at', '==', null)
      .limit(1)
      .get()
    documentsActive = !publishedDocSnap.empty
  }

  // signup_documents: the published + public documents the studio attached to the
  // signup consent checkbox (installed_plugins/documents.config.signupDocumentIds).
  // Denormalized here so the anonymous signup form reads consent links from one
  // world-readable doc. Read each referenced document's public_profile summary —
  // an id whose summary is missing (unpublished/unshared) is silently skipped.
  let signupDocuments: Array<{ slug: string; title: string; kind: DocumentKind }> = []
  if (documentsPluginActive) {
    const ids = (documentsPluginSnap.data()?.config?.signupDocumentIds as unknown)
    const idList = Array.isArray(ids) ? (ids as string[]).filter((v) => typeof v === 'string') : []
    if (idList.length > 0) {
      const summaries = await Promise.all(
        idList.map((id) =>
          db.doc(`${DOCUMENTS_COLLECTION}/${id}/public_profile/${id}`).get()
        )
      )
      signupDocuments = summaries
        .filter((s) => s.exists)
        .map((s) => {
          const d = s.data()!
          return {
            slug: d.slug as string,
            title: (d.title as string) || '',
            kind: (d.kind as DocumentKind) || 'other',
          }
        })
    }
  }

  // booking: base feature — available whenever booking settings have been configured
  // (bookingSettings lands on the public_profile via syncBookingSettings; here we
  // mirror the same signal used elsewhere: the settings sub-doc existence / field).
  // Default to true — booking works on every plan, plugin-free.
  const bookingActive = true

  // shop: live when a sellable channel is enabled — the products or online-courses
  // plugin, or Stripe Connect (subscriptions). The public shop aggregates whatever
  // exists, so this capability check is enough to offer it as a landing surface.
  const productsPluginSnap = await db
    .doc(`${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/products`)
    .get()
  const productsPluginActive = productsPluginSnap.exists && productsPluginSnap.data()?.status === 'active'
  const onlineCoursesActive =
    onlineCoursesPluginSnap.exists && onlineCoursesPluginSnap.data()?.status === 'active'
  const connectEnabled =
    (data.payments as { connectStatus?: string } | undefined)?.connectStatus === 'enabled'
  const shopActive = productsPluginActive || onlineCoursesActive || connectEnabled

  // signup is a base surface (the subscription sign-up form) — available on every
  // plan, so always live. Denormalized here so the public root can redirect to it
  // when it's chosen as the default landing.
  const signupActive = true

  const active_public_surfaces: ActivePublicSurfaces = {
    site: siteActive,
    space: spaceActive,
    booking: bookingActive,
    signup: signupActive,
    shop: shopActive,
    forms: formsActive,
    documents: documentsActive,
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
    // Space "complete your signup" reminder toggle (absent ⇒ on) — the Space only
    // reads public_profile, so the setting must be mirrored here.
    space_signup_nudge: data.settings?.space?.signup_nudge !== false,
    active_public_surfaces,
    // Recomputed every run (may be empty) so stale consent links never linger.
    signup_documents: signupDocuments,
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

  // Re-derive the opt-in public coach roster too — a team write is also how
  // `public_coaches_enabled` gets toggled, and that field lives on this same doc.
  await rebuildTeamPublicCoaches(teamId)
})
