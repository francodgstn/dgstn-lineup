import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { hasTeamRole } from '../utils/teams'
import { unpublishSiteForTeam, touchTeamForSurfaceRecompute } from '../utils/plugins'
import { sanitizeRichHtml } from '../utils/sanitizeHtml'
import {
  SITE_PUBLISHED_COLLECTION,
  SITE_DRAFTS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_PLACES_SUBCOLLECTION,
  ORGANIZATIONS_COLLECTION,
  ORG_PLACES_SUBCOLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
} from '@linyup/shared'
import type {
  PublishedSite,
  SiteMeta,
  WebsiteSection,
  HeroSection,
  ContentSection,
  GallerySection,
  ContactSection,
} from '@linyup/shared'

// ─── sanitizers ───────────────────────────────────────────────────────────────
// The draft is authored by a (semi-trusted) manager, but site_published is
// fully public. We re-derive every published field from an explicit whitelist so
// nothing unexpected — and nothing restricted — can leak into the public doc.
//
// The primitives + the four "presentational" section builders below (hero,
// content, gallery, contact) are exported so the organization website module
// (../orgWebsite) can reuse the EXACT same rules instead of re-implementing them —
// those four section types are shared verbatim between the team site and the org
// site; only the aggregate section types (activities/pricing/schedule/places at
// team level, clubs/locations/coaches at org level) differ.

export type Dict = Record<string, unknown>

export const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {})

export function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}
export function optStr(v: unknown, max = 2000): string | undefined {
  const s = str(v, max)
  return s ? s : undefined
}
/** Allow only https?:// URLs; everything else (javascript:, data:, …) is dropped. */
export function safeUrl(v: unknown): string | undefined {
  return typeof v === 'string' && /^https?:\/\/.+/.test(v) ? v.slice(0, 2000) : undefined
}
export function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
export function bool(v: unknown): boolean {
  return v === true
}
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}
/** Drop keys whose value is undefined (Firestore rejects undefined). */
export function clean<T extends Dict>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k]
  return obj
}

// Rich-text HTML sanitizer (RICH_TEXT_OPTIONS + sanitizeRichHtml) lives in
// ../utils/sanitizeHtml so the documents plugin's public sync shares the exact
// same allowlist. Everything else — <script>, styles, event handlers, non-http(s)
// URLs — is stripped before the HTML reaches the fully-public site_published doc.

export function sanitizeCta(v: unknown): Dict | undefined {
  const d = asDict(v)
  const label = optStr(d.label, 120)
  if (!label) return undefined
  const action0 = oneOf(d.action, ['booking', 'signup', 'membership', 'url'] as const, 'url')
  const action = action0 === 'membership' ? 'signup' : action0 // normalize legacy alias
  return clean({ label, action, url: action === 'url' ? safeUrl(d.url) : undefined })
}

// ─── shared section builders (reused by ../orgWebsite) ─────────────────────────

export function sanitizeHeroSection(d: Dict, id: string): HeroSection | null {
  const headline = optStr(d.headline, 200)
  if (!headline) return null
  return clean({
    id, type: 'hero', headline,
    subheadline: optStr(d.subheadline, 400),
    bgImageUrl: safeUrl(d.bgImageUrl),
    overlay: num(d.overlay, 0, 100, 40),
    align: oneOf(d.align, ['left', 'center'] as const, 'center'),
    cta: sanitizeCta(d.cta),
  }) as unknown as HeroSection
}

// Generic content block. 'about' is the legacy literal — normalized to 'content'
// on publish. Heading is optional; drop only when fully empty.
export function sanitizeContentSection(d: Dict, id: string): ContentSection | null {
  const heading = optStr(d.heading, 200)
  const body = sanitizeRichHtml(str(d.body, 50000))
  const imageUrl = safeUrl(d.imageUrl)
  if (!heading && !body && !imageUrl) return null
  return clean({
    id, type: 'content', heading, body,
    imageUrl,
    imageSide: oneOf(d.imageSide, ['left', 'right'] as const, 'left'),
  }) as unknown as ContentSection
}

export function sanitizeGallerySection(d: Dict, id: string): GallerySection | null {
  const images = (Array.isArray(d.images) ? d.images : [])
    .map((img) => {
      const i = asDict(img)
      const url = safeUrl(i.url)
      return url ? clean({ url, caption: optStr(i.caption, 200) }) : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 60)
  const columns = num(d.columns, 2, 4, 3)
  return clean({
    id, type: 'gallery',
    heading: optStr(d.heading, 200),
    images,
    columns: (columns === 2 || columns === 4 ? columns : 3) as 2 | 3 | 4,
  }) as unknown as GallerySection
}

export function sanitizeContactSection(d: Dict, id: string): ContactSection {
  return clean({
    id, type: 'contact',
    heading: optStr(d.heading, 200),
    address: optStr(d.address, 400),
    phone: optStr(d.phone, 64),
    email: optStr(d.email, 200),
    hours: optStr(d.hours, 400),
    mapQuery: optStr(d.mapQuery, 400),
    showSocial: bool(d.showSocial),
  }) as unknown as ContactSection
}

function sanitizeSection(raw: unknown): WebsiteSection | null {
  const d = asDict(raw)
  const id = optStr(d.id, 64)
  const type = d.type
  if (!id || typeof type !== 'string') return null

  const section = buildSection(d, id, type)
  if (!section) return null
  // Nav membership is common to every section type. Stored only when explicitly
  // hidden; absence means "visible" (the renderer defaults showInNav to true).
  if (d.showInNav === false) section.showInNav = false
  return section
}

function buildSection(d: Dict, id: string, type: string): WebsiteSection | null {
  switch (type) {
    case 'hero':
      return sanitizeHeroSection(d, id)
    // Generic content block. 'about' is the legacy literal — normalized to
    // 'content' on publish. Heading is optional; drop only when fully empty.
    case 'content':
    case 'about':
      return sanitizeContentSection(d, id)
    case 'gallery':
      return sanitizeGallerySection(d, id)
    case 'activities': {
      const columns = num(d.columns, 2, 4, 3)
      return clean({
        id, type: 'activities',
        heading: optStr(d.heading, 200),
        subheading: optStr(d.subheading, 400),
        source: 'activities',
        columns: (columns === 2 || columns === 4 ? columns : 3) as 2 | 3 | 4,
        showBooking: bool(d.showBooking),
      }) as unknown as WebsiteSection
    }
    case 'pricing': {
      return clean({
        id, type: 'pricing',
        heading: optStr(d.heading, 200),
        subheading: optStr(d.subheading, 400),
        source: 'subscriptions',
        ctaLabel: optStr(d.ctaLabel, 120),
      }) as unknown as WebsiteSection
    }
    case 'schedule': {
      return clean({
        id, type: 'schedule',
        heading: optStr(d.heading, 200),
        source: 'sessions',
        windowDays: num(d.windowDays, 1, 60, 7),
        maxItems: num(d.maxItems, 0, 50, 0) || undefined,
        activityId: optStr(d.activityId, 64),
        displayMode: d.displayMode === 'week' ? 'week' : 'list',
        showBooking: bool(d.showBooking),
      }) as unknown as WebsiteSection
    }
    case 'contact':
      return sanitizeContactSection(d, id)
    // Places: keep only the selection + presentation here; the actual place data
    // is embedded at publish time (enrichSectionsWithPlaces) — sanitizers are pure.
    case 'places': {
      const columns = num(d.columns, 2, 4, 3)
      const placeIds = (Array.isArray(d.placeIds) ? d.placeIds : [])
        .map((x) => optStr(x, 64))
        .filter((x): x is string => !!x)
        .slice(0, 50)
      return clean({
        id, type: 'places',
        heading: optStr(d.heading, 200),
        subheading: optStr(d.subheading, 400),
        columns: (columns === 2 || columns === 4 ? columns : 3) as 2 | 3 | 4,
        placeIds: placeIds.length ? placeIds : undefined,
      }) as unknown as WebsiteSection
    }
    default:
      return null
  }
}

// Resolve a team's place pool (own team_places + inherited org_places) into a
// public-safe map + the team's primary place, for publish-time embedding.
async function loadPlacePool(
  fs: admin.firestore.Firestore,
  teamId: string,
  team: Dict
): Promise<{
  byId: Map<string, { id: string; name: string; address?: string; mapsLink?: string }>
  primary: { name: string; address?: string; mapsLink?: string } | null
}> {
  const byId = new Map<string, { id: string; name: string; address?: string; mapsLink?: string }>()
  const teamSnap = await fs
    .collection(TEAMS_COLLECTION)
    .doc(teamId)
    .collection(TEAM_PLACES_SUBCOLLECTION)
    .get()
  const orgId = optStr((team as Dict).org_id, 64)
  const orgSnap = orgId
    ? await fs
        .collection(ORGANIZATIONS_COLLECTION)
        .doc(orgId)
        .collection(ORG_PLACES_SUBCOLLECTION)
        .get()
    : null

  const add = (id: string, data: Dict) =>
    byId.set(
      id,
      clean({ id, name: str(data.name, 200), address: optStr(data.address, 400), mapsLink: safeUrl(data.mapsLink) }) as {
        id: string
        name: string
        address?: string
        mapsLink?: string
      }
    )
  teamSnap.docs.forEach((d) => add(d.id, d.data() as Dict))
  orgSnap?.docs.forEach((d) => add(d.id, d.data() as Dict))

  const primaryDoc = teamSnap.docs.find((d) => (d.data() as Dict).isPrimary === true) ?? teamSnap.docs[0]
  const pd = primaryDoc?.data() as Dict | undefined
  const primary = pd
    ? (clean({ name: str(pd.name, 200), address: optStr(pd.address, 400), mapsLink: safeUrl(pd.mapsLink) }) as {
        name: string
        address?: string
        mapsLink?: string
      })
    : null
  return { byId, primary }
}

// Embed selected places into 'places' sections + default the Contact map from the
// team's primary place. Mutates the sanitized sections in place.
async function enrichSectionsWithPlaces(
  fs: admin.firestore.Firestore,
  teamId: string,
  team: Dict,
  sections: WebsiteSection[]
): Promise<void> {
  if (!sections.some((s) => s.type === 'places' || s.type === 'contact')) return
  const { byId, primary } = await loadPlacePool(fs, teamId, team)
  for (const s of sections) {
    if (s.type === 'places') {
      const resolved = (s.placeIds ?? []).map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
      s.places = resolved.length ? resolved : undefined
    } else if (s.type === 'contact' && primary) {
      if (!s.address) s.address = primary.address
      if (!s.mapQuery) s.mapQuery = primary.address || primary.name
    }
  }
}

export function sanitizeMeta(raw: unknown, fallbackTitle: string): SiteMeta {
  const d = asDict(raw)
  const header = asDict(d.header)
  const footer = asDict(d.footer)
  const seo = asDict(d.seo)
  const headerCtaAction0 = oneOf(header.ctaAction, ['booking', 'signup', 'membership', 'url'] as const, 'booking')
  const headerCtaAction = headerCtaAction0 === 'membership' ? 'signup' : headerCtaAction0 // normalize legacy

  return clean({
    title: optStr(d.title, 200) ?? fallbackTitle,
    theme: oneOf(d.theme, ['light', 'dark', 'auto'] as const, 'light'),
    accentColor: optStr(d.accentColor, 32) ?? '#6366f1',
    font: oneOf(d.font, ['sans', 'serif', 'rounded'] as const, 'sans'),
    seo: clean({
      title: optStr(seo.title, 200),
      description: optStr(seo.description, 400),
      ogImageUrl: safeUrl(seo.ogImageUrl),
    }),
    header: clean({
      showNav: header.showNav !== false,
      ctaLabel: optStr(header.ctaLabel, 120),
      ctaAction: headerCtaAction,
      ctaUrl: headerCtaAction === 'url' ? safeUrl(header.ctaUrl) : undefined,
    }),
    footer: clean({ showSocial: footer.showSocial !== false }),
  }) as SiteMeta
}

// ─── publishWebsite ─────────────────────────────────────────────────────────────
// Reads the team's private draft, sanitizes it to a public-safe payload, and
// writes site_published/{teamId} (world-readable). Also flags the draft enabled.

export const publishWebsite = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const uid = request.auth.uid
  const teamId = (request.data?.teamId ?? '') as string
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  if (!(await hasTeamRole(uid, teamId, 'manager'))) {
    throw new HttpsError('permission-denied', 'Manager access required')
  }

  const fs = admin.firestore()

  // Defense in depth: the Website plugin must be installed & active. The install
  // flow already gates by plan/add-on; this stops publishing without the plugin.
  const pluginSnap = await fs
    .doc(`${TEAMS_COLLECTION}/${teamId}/${INSTALLED_PLUGINS_SUBCOLLECTION}/website`)
    .get()
  if (!pluginSnap.exists || pluginSnap.data()?.status !== 'active') {
    throw new HttpsError('failed-precondition', 'The Website plugin is not active for this team')
  }

  const draftSnap = await fs.doc(`${SITE_DRAFTS_COLLECTION}/${teamId}`).get()
  if (!draftSnap.exists) throw new HttpsError('not-found', 'No site draft to publish')
  const draft = draftSnap.data() as Dict

  const teamSnap = await fs.doc(`${TEAMS_COLLECTION}/${teamId}`).get()
  if (!teamSnap.exists) throw new HttpsError('not-found', 'Team not found')
  const team = teamSnap.data() as Dict
  const slug = optStr(team.slug, 80)
  if (!slug) throw new HttpsError('failed-precondition', 'Set a team URL (slug) before publishing')

  const name = optStr(team.name, 200) ?? 'Site'
  const sections = (Array.isArray(draft.sections) ? draft.sections : [])
    // Drop sections the studio toggled hidden — they stay in the draft but never
    // reach the published site (or its nav).
    .filter((raw) => !(raw && typeof raw === 'object' && (raw as Dict).hidden === true))
    .map(sanitizeSection)
    .filter((s): s is WebsiteSection => s !== null)
    .slice(0, 30)

  // Embed selected places into 'places' sections + fill the Contact map from the
  // team's primary place. Done after sanitizing (needs Firestore reads).
  await enrichSectionsWithPlaces(fs, teamId, team, sections)

  // Denormalise social links (already public via team.public_profile) so the
  // published doc is self-contained for footer/contact icons.
  const socialLinks = (Array.isArray(team.socialLinks) ? team.socialLinks : [])
    .map((s) => {
      const d = asDict(s)
      const platform = optStr(d.platform, 32)
      const url = safeUrl(d.url)
      return platform && url ? { platform, url } : null
    })
    .filter((x): x is { platform: string; url: string } => x !== null)

  const plan = optStr(team.plan, 32) ?? 'free'

  // Shaped to match PublishedSite; typed as Dict for the Firestore write since
  // values are re-derived from sanitizers (platform strings, server timestamps).
  const published: Dict = clean({
    teamId,
    slug,
    name,
    meta: sanitizeMeta(draft.meta, name),
    sections,
    socialLinks: socialLinks.length ? socialLinks : undefined,
    showBranding: plan === 'free' ? true : undefined,
    published_at: FieldValue.serverTimestamp() as unknown as PublishedSite['published_at'],
    updated_at: FieldValue.serverTimestamp() as unknown as PublishedSite['updated_at'],
  })

  await fs.doc(`${SITE_PUBLISHED_COLLECTION}/${teamId}`).set(published)
  await draftSnap.ref.set(
    { enabled: true, updated_at: FieldValue.serverTimestamp(), updatedBy: uid },
    { merge: true },
  )

  // The published site now exists but lives outside the team doc — nudge it so
  // syncTeamPublicProfile recomputes active_public_surfaces.site → live.
  await touchTeamForSurfaceRecompute(teamId)

  return { ok: true, slug }
})

// ─── unpublishWebsite ───────────────────────────────────────────────────────────
// Removes the public snapshot so /site/[slug] 404s, and flags the draft disabled.

export const unpublishWebsite = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')
  const uid = request.auth.uid
  const teamId = (request.data?.teamId ?? '') as string
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  if (!(await hasTeamRole(uid, teamId, 'manager'))) {
    throw new HttpsError('permission-denied', 'Manager access required')
  }

  // Delegate core teardown to shared helper (also used by plugin-status trigger
  // and plan downgrade). We additionally record the uid of who triggered it.
  await unpublishSiteForTeam(teamId)
  // Stamp the user who initiated unpublish onto the draft (non-critical; merge).
  const fs = admin.firestore()
  await fs.doc(`${SITE_DRAFTS_COLLECTION}/${teamId}`).set(
    { updatedBy: uid },
    { merge: true },
  )

  // Site snapshot is gone — recompute so active_public_surfaces.site → not live.
  await touchTeamForSurfaceRecompute(teamId)

  return { ok: true }
})
