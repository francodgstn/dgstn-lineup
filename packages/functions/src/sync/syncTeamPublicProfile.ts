// Keeps teams/{teamId}/public_profile/{teamId} in sync when a team document changes
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  SITE_PUBLISHED_COLLECTION,
  FORMS_COLLECTION,
  DOCUMENTS_COLLECTION,
  TEAM_SETTINGS_SUBCOLLECTION,
  DOCUMENTS_SETTINGS_DOC_ID,
  WAIVER_POLICY_SUBCOLLECTION,
  WAIVER_POLICY_DOC_ID,
  publicPagesIndexable,
  resolveNoShowPolicy,
  resolveSignupDocumentIds,
  resolveSystemLinkTarget,
  toKioskPublicConfig,
  normalizeKioskConfig,
} from '@linyup/shared'
import type {
  PublicSurface,
  ActivePublicSurfaces,
  DocumentKind,
  KioskConfig,
  GiftCardSettings,
  PublicRequiredWaiver,
  RequiredWaiverEntry,
  SaasPlan,
} from '@linyup/shared'
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
  // kiosk: entrance-tablet surface — live whenever the plugin install is active.
  const [websitePluginSnap, sitePublishedSnap, kioskPluginSnap] = await Promise.all([
    db
      .doc(
        `${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/website`
      )
      .get(),
    db.doc(`${SITE_PUBLISHED_COLLECTION}/${teamId}`).get(),
    db.doc(`${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/kiosk`).get(),
  ])
  const siteActive =
    websitePluginSnap.exists &&
    websitePluginSnap.data()?.status === 'active' &&
    sitePublishedSnap.exists
  const kioskActive = kioskPluginSnap.exists && kioskPluginSnap.data()?.status === 'active'

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

  // documents: NO PLUGIN PROBE — Documents is a default feature on every plan.
  //
  // The liveness test is the existence of a public_profile MIRROR, not of a
  // published document, and the difference is the whole point. A team that
  // trialed on Studio, published documents and was then downgraded still HAS
  // those documents: the old teardown deleted their mirrors and nothing else. A
  // probe over the root `documents` collection would therefore flip this surface
  // live again on the next unrelated team write, and /public-page would advertise
  // it — and offer it as a default landing surface — over a page that renders the
  // empty state, because the mirror backfill is opt-in per team and may never
  // have been run for them. Probing the mirrors makes this flag agree with what a
  // visitor would actually see.
  //
  // Same shape and cost as the forms check above (one limit(1) query), over the
  // collection that actually backs the page. No new index: the public documents
  // index page already runs this exact teamId + type query.
  const documentMirrorSnap = await db
    .collectionGroup('public_profile')
    .where('teamId', '==', teamId)
    .where('type', '==', 'document')
    .limit(1)
    .get()
  const documentsActive = !documentMirrorSnap.empty

  // signup_documents: the published + public documents the studio attached to the
  // signup consent checkbox. Denormalized here so the anonymous signup form reads
  // consent links from one world-readable doc. Read each referenced document's
  // public_profile summary — an id whose summary is missing (unpublished /
  // unshared) is silently skipped, which is right for a display list of links and
  // is exactly why the booking gate reads the waiver POLICY instead.
  //
  // DUAL READ, in ONE place (resolveSignupDocumentIds): the new
  // `teams/{id}/settings/documents` home, falling back to the retired plugin
  // config for teams the backfill has not reached. The panel that writes it reads
  // through the same helper, so a studio's save and this recompute can never
  // disagree about which location wins.
  const [documentsSettingsSnap, legacyDocumentsPluginSnap] = await Promise.all([
    db.doc(`${TEAMS_COLLECTION}/${teamId}/${TEAM_SETTINGS_SUBCOLLECTION}/${DOCUMENTS_SETTINGS_DOC_ID}`).get(),
    db.doc(`${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/documents`).get(),
  ])
  const idList = resolveSignupDocumentIds({
    settings: documentsSettingsSnap.data() as { signupDocumentIds?: string[] } | undefined,
    legacyPluginConfig: legacyDocumentsPluginSnap.data()?.config as
      | { signupDocumentIds?: unknown }
      | undefined,
  })
  let signupDocuments: Array<{
    documentId: string
    slug: string
    title: string
    kind: DocumentKind
    version: number | null
  }> = []
  if (idList.length > 0) {
    const summaries = await Promise.all(
      idList.map((id) => db.doc(`${DOCUMENTS_COLLECTION}/${id}/public_profile/${id}`).get())
    )
    signupDocuments = summaries
      .filter((s) => s.exists)
      .map((s) => {
        const d = s.data()!
        return {
          // The id, so the signup form can echo WHICH document it showed and
          // completeSignup can write a ledger row without trusting a
          // client-supplied slug. The mirror doc id IS the document id.
          documentId: s.id,
          slug: d.slug as string,
          title: (d.title as string) || '',
          kind: (d.kind as DocumentKind) || 'other',
          // The version the visitor will actually be shown. null for a document
          // that predates versioning and has not been backfilled — the form
          // renders it, the ledger skips it, and nothing pretends otherwise.
          version: typeof d.version === 'number' ? (d.version as number) : null,
        }
      })
  }

  // required_waivers: the SUMMARY of the team's required waivers, read from the
  // server-written policy document — never from the `documents` collection, and
  // never carrying a body. It is a RENDERING HINT: the public surface calls
  // resolveWaiverRequirement if and only if this list is non-empty, so a tenant
  // with no waiver pays zero extra round-trips on the acquisition path, while
  // AUTHORIZATION always reads the policy document itself (which fails closed).
  //
  // A briefly-stale empty list therefore degrades to a server refusal the
  // surface can act on, never to a compliance hole — and every policy writer
  // touches the team document in the same transaction, so it is never stale by
  // more than one sync.
  const waiverPolicySnap = await db
    .doc(`${TEAMS_COLLECTION}/${teamId}/${WAIVER_POLICY_SUBCOLLECTION}/${WAIVER_POLICY_DOC_ID}`)
    .get()
  const requiredWaivers: PublicRequiredWaiver[] = (
    (waiverPolicySnap.data()?.required as RequiredWaiverEntry[] | undefined) ?? []
  ).map((e) => ({
    documentId: e.documentId,
    slug: e.slug,
    title: e.title,
    version: e.current_version,
    mayIncludeMinors: e.mayIncludeMinors === true,
  }))

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
  const giftCardsPluginSnap = await db
    .doc(`${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/gift-cards`)
    .get()
  const giftCardsPluginActive =
    giftCardsPluginSnap.exists && giftCardsPluginSnap.data()?.status === 'active'
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
    kiosk: kioskActive,
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
    // Whether this team's public pages may be crawled. Denormalized for the same
    // reason as showBranding — the pages that need it read public_profile alone —
    // but it is DELIBERATELY NOT the same boolean: showBranding asks "is this the
    // free tier", while indexability also refuses a trial, which is the tier every
    // throwaway signup lands on. See publicPagesIndexable.
    public_pages_indexable: publicPagesIndexable({
      plan: data.plan as SaasPlan | undefined,
      plan_status: data.plan_status as string | undefined,
    }),
    // Billing currency for the website pricing table (bio-link/website never read teams/).
    default_currency: (data.default_currency as string | undefined) || null,
    // Team-wide cancellation policy default (activity-level override lives on
    // Activity.cancellationPolicy). Public because it's shown BEFORE booking,
    // not just emailed after — see bookingConfirmationInstructions for the
    // email-only sibling this deliberately does NOT reuse.
    bookingCancellationPolicy:
      (data.settings as { bookingCancellationPolicy?: string } | undefined)
        ?.bookingCancellationPolicy || null,
    // The team-wide "how do I get it?" default for product sales (UX-79). Same
    // home, same shape and the same reason for being public as the line above:
    // it is stated BEFORE the buyer pays, on a surface that reads public_profile
    // alone. The per-product override rides on the mirrored product entry.
    productCollectionNote:
      (data.settings as { productCollectionNote?: string } | undefined)
        ?.productCollectionNote || null,
    // The no-show policy's public TERMS (fee + threshold), so a booking surface
    // can state them BEFORE the button rather than in the email that follows.
    // Resolved through the same `resolveNoShowPolicy` the strike counter uses,
    // so "off" means the same thing on both sides of the mirror; `enabled` is
    // not carried — null IS off. See TeamPublicProfile.noShowPolicy.
    noShowPolicy: (() => {
      const policy = resolveNoShowPolicy(data.settings)
      return policy ? { feeAmount: policy.feeAmount, threshold: policy.threshold } : null
    })(),
    // Gift cards (E3): public-safe config only (enabled + purchasable face values —
    // never balances/codes) so the public shop can offer them without reading the
    // private team doc. Mirrors teams/{id}.settings.giftCards.
    // Gated on the gift-cards PLUGIN as well as the setting: uninstalling must
    // take the offer off the public shop, and the mirror is the only thing the
    // shop reads. This recomputes on install/uninstall because
    // onInstalledPluginStatusChange touches the team doc.
    //
    // SELLING only. Redeeming an already-issued card does not consult this — it
    // is money the studio has taken, and a plugin toggle must not void it.
    giftCards: (() => {
      if (!giftCardsPluginActive) return { enabled: false, amounts: [] }
      const raw = (data.settings as { giftCards?: GiftCardSettings } | undefined)?.giftCards
      return raw?.enabled === true && Array.isArray(raw.amounts)
        ? { enabled: true, amounts: raw.amounts }
        : { enabled: false, amounts: [] }
    })(),
    // Space "complete your signup" reminder toggle (absent ⇒ on) — the Space only
    // reads public_profile, so the setting must be mirrored here.
    space_signup_nudge: data.settings?.space?.signup_nudge !== false,
    active_public_surfaces,
    // Recomputed every run (may be empty) so stale consent links never linger.
    signup_documents: signupDocuments,
    // Recomputed every run from the waiver policy, for the same reason.
    required_waivers: requiredWaivers,
    updated_at: event.data!.after.updateTime,
  }

  // Only write default_public_surface when explicitly set; omit the key entirely
  // if unset so existing docs with no preference are not polluted with undefined.
  if (defaultSurface !== undefined) {
    publicProfile.default_public_surface = defaultSurface
  }

  // Denormalize the kiosk config (MINUS the PIN — toKioskPublicConfig strips it)
  // when the plugin is active; explicitly delete the field otherwise so a stale
  // config can never linger on a public, world-readable doc after deactivation.
  if (kioskActive) {
    // A freshly-installed kiosk persists `config: {}`; normalize fills every
    // field from the defaults so toKioskPublicConfig never dereferences a missing
    // one (which previously threw and aborted the ENTIRE public-profile sync for
    // the team, leaving kiosk — and every other surface — stale).
    const kioskCfg = kioskPluginSnap.data()?.config as Partial<KioskConfig> | undefined
    publicProfile.kiosk = toKioskPublicConfig(normalizeKioskConfig(kioskCfg))
  } else {
    publicProfile.kiosk = FieldValue.delete()
  }

  // Merge so sibling syncs that write other public_profile fields with merge
  // (e.g. aggregator_subscription_types, bookingSettings) aren't clobbered by a
  // team-doc write. Every field above is recomputed each run, so merge is safe.
  await afterRef.collection('public_profile').doc(teamId).set(publicProfile, { merge: true })

  // Re-derive the opt-in public coach roster too — a team write is also how
  // `public_coaches_enabled` gets toggled, and that field lives on this same doc.
  await rebuildTeamPublicCoaches(teamId)
})
