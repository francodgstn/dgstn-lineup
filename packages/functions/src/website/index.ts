import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { hasTeamRole } from '../utils/teams'
import {
  SITE_PUBLISHED_COLLECTION,
  SITE_DRAFTS_COLLECTION,
  TEAMS_COLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
} from '@linyup/shared'
import type {
  PublishedSite,
  SiteMeta,
  WebsiteSection,
} from '@linyup/shared'

// ─── sanitizers ───────────────────────────────────────────────────────────────
// The draft is authored by a (semi-trusted) manager, but site_published is
// fully public. We re-derive every published field from an explicit whitelist so
// nothing unexpected — and nothing restricted — can leak into the public doc.

type Dict = Record<string, unknown>

const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {})

function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}
function optStr(v: unknown, max = 2000): string | undefined {
  const s = str(v, max)
  return s ? s : undefined
}
/** Allow only https?:// URLs; everything else (javascript:, data:, …) is dropped. */
function safeUrl(v: unknown): string | undefined {
  return typeof v === 'string' && /^https?:\/\/.+/.test(v) ? v.slice(0, 2000) : undefined
}
function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
function bool(v: unknown): boolean {
  return v === true
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}
/** Drop keys whose value is undefined (Firestore rejects undefined). */
function clean<T extends Dict>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k]
  return obj
}

function sanitizeCta(v: unknown): Dict | undefined {
  const d = asDict(v)
  const label = optStr(d.label, 120)
  if (!label) return undefined
  const action = oneOf(d.action, ['booking', 'membership', 'url'] as const, 'url')
  return clean({ label, action, url: action === 'url' ? safeUrl(d.url) : undefined })
}

function sanitizeSection(raw: unknown): WebsiteSection | null {
  const d = asDict(raw)
  const id = optStr(d.id, 64)
  const type = d.type
  if (!id || typeof type !== 'string') return null

  switch (type) {
    case 'hero': {
      const headline = optStr(d.headline, 200)
      if (!headline) return null
      return clean({
        id, type: 'hero', headline,
        subheadline: optStr(d.subheadline, 400),
        bgImageUrl: safeUrl(d.bgImageUrl),
        overlay: num(d.overlay, 0, 100, 40),
        align: oneOf(d.align, ['left', 'center'] as const, 'center'),
        cta: sanitizeCta(d.cta),
      }) as unknown as WebsiteSection
    }
    case 'about': {
      const heading = optStr(d.heading, 200)
      if (!heading) return null
      return clean({
        id, type: 'about', heading,
        body: str(d.body, 5000),
        imageUrl: safeUrl(d.imageUrl),
        imageSide: oneOf(d.imageSide, ['left', 'right'] as const, 'left'),
      }) as unknown as WebsiteSection
    }
    case 'gallery': {
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
        activityId: optStr(d.activityId, 64),
      }) as unknown as WebsiteSection
    }
    case 'contact': {
      return clean({
        id, type: 'contact',
        heading: optStr(d.heading, 200),
        address: optStr(d.address, 400),
        phone: optStr(d.phone, 64),
        email: optStr(d.email, 200),
        hours: optStr(d.hours, 400),
        mapQuery: optStr(d.mapQuery, 400),
        showSocial: bool(d.showSocial),
      }) as unknown as WebsiteSection
    }
    default:
      return null
  }
}

function sanitizeMeta(raw: unknown, fallbackTitle: string): SiteMeta {
  const d = asDict(raw)
  const header = asDict(d.header)
  const footer = asDict(d.footer)
  const seo = asDict(d.seo)
  const headerCtaAction = oneOf(header.ctaAction, ['booking', 'membership', 'url'] as const, 'booking')

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
    .map(sanitizeSection)
    .filter((s): s is WebsiteSection => s !== null)
    .slice(0, 30)

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

  const fs = admin.firestore()
  await fs.doc(`${SITE_PUBLISHED_COLLECTION}/${teamId}`).delete()
  await fs.doc(`${SITE_DRAFTS_COLLECTION}/${teamId}`).set(
    { enabled: false, updated_at: FieldValue.serverTimestamp(), updatedBy: uid },
    { merge: true },
  )

  return { ok: true }
})
