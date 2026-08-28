import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import {
  SITE_PUBLISHED_COLLECTION,
  siteI18nDocId,
  translationSourceHash,
  localizedPublicUrl,
} from '@linyup/shared'
import type { SiteI18nManifest, UiLanguage } from '@linyup/shared'
import { restString as str, restMap as map, restArray, fetchDocumentFields } from '@/lib/publicMetaRest'
import type { RestValue } from '@/lib/publicMetaRest'
import PublicSite from './PublicSite'

// Public website route. Full-bleed (no app/bio-link chrome) and reads only the
// fully-public site_published collection — structured to later lift onto a
// dedicated subdomain / custom domain with no data-model change.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true'

function parseManifest(v?: RestValue): SiteI18nManifest | undefined {
  const fields = map(v)
  const srcLang = str(fields.srcLang)
  if (!srcLang) return undefined
  const locales = restArray(fields.locales)
    .map((x) => x.stringValue)
    .filter((x): x is string => !!x)
  return { srcLang: srcLang as UiLanguage, locales: locales as UiLanguage[] }
}

// Resolve the published site's public SEO fields by slug via the Firestore REST
// API. Deliberately NOT the web SDK: inside the Next server runtime the SDK's
// streamed query responses come back empty (fetch-stream buffering), which made
// every page title fall back to "Site not found". A single unauthenticated REST
// read (rules: public) is dependency-free and works in any server runtime.
async function fetchSiteMeta(slug: string) {
  try {
    const base = USE_EMULATORS
      ? `http://${process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080'}/v1`
      : 'https://firestore.googleapis.com/v1'
    const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    const url =
      `${base}/projects/${PROJECT_ID}/databases/(default)/documents:runQuery` +
      (!USE_EMULATORS && key ? `?key=${key}` : '')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: SITE_PUBLISHED_COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'slug' },
              op: 'EQUAL',
              value: { stringValue: slug },
            },
          },
          limit: 1,
        },
      }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`runQuery HTTP ${res.status}`)
    const rows = (await res.json()) as {
      document?: { name?: string; fields?: Record<string, RestValue> }
    }[]
    const document = rows.find((r) => r.document)?.document
    const fields = document?.fields
    if (!fields) return null
    // The doc id IS the teamId — pulled off the resource name (…/documents/
    // site_published/{teamId}) rather than stored redundantly in a field.
    const teamId = document?.name?.split('/').pop()
    const meta = map(fields.meta)
    const seo = map(meta.seo)
    return {
      teamId,
      name: str(fields.name),
      title: str(meta.title),
      seoTitle: str(seo.title),
      description: str(seo.description),
      ogImageUrl: str(seo.ogImageUrl),
      i18n: parseManifest(fields.i18n),
    }
  } catch (e) {
    // Metadata falls back to the generic title, but never silently — a broken
    // server-side read otherwise masquerades as a missing site.
    console.error('[public-site] metadata fetch failed:', e)
    return null
  }
}

// Emit real SEO / OpenGraph tags into <head> from the published site's stored
// meta.seo (the client renderer never touches the document head).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const site = await fetchSiteMeta(slug)

  if (!site) {
    const t = await getTranslations({ locale, namespace: 'Site' })
    return { title: t('notFoundTitle') }
  }

  // No configured base URL — derive the absolute origin from the request so the
  // canonical / og:url survive the future move to a custom domain.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const origin = host ? `${proto}://${host}` : undefined
  const url = origin ? localizedPublicUrl(origin, locale, slug, 'site') : undefined

  // The base text a stored translation unit was made from — substituted only
  // while its srcHash still matches, exactly like the render-path resolver
  // (applySiteTranslations). A stale or missing unit degrades to the base
  // (authoring-language) SEO text, never to blank metadata.
  let seoTitle = site.seoTitle
  let description = site.description

  const manifest = site.i18n
  if (manifest && site.teamId && locale !== manifest.srcLang && (manifest.locales as string[]).includes(locale)) {
    const sidecarFields = await fetchDocumentFields(
      `${SITE_PUBLISHED_COLLECTION}/${siteI18nDocId(site.teamId, locale)}`
    )
    const units = map(sidecarFields?.units)
    if (typeof site.seoTitle === 'string' && site.seoTitle.trim() !== '') {
      const unit = map(units['seo.title'])
      const text = str(unit.text)
      if (text && str(unit.srcHash) === translationSourceHash(site.seoTitle)) seoTitle = text
    }
    if (typeof site.description === 'string' && site.description.trim() !== '') {
      const unit = map(units['seo.description'])
      const text = str(unit.text)
      if (text && str(unit.srcHash) === translationSourceHash(site.description)) description = text
    }
  }

  const title = seoTitle || site.title || site.name || slug
  const ogImageUrl = site.ogImageUrl

  // hreflang alternates — only for a site with a translation manifest, and only
  // for the locales it actually carries; x-default points at the authoring
  // language, the one that's never gated on a translation existing.
  const languages: Record<string, string> | undefined =
    manifest && origin
      ? Object.fromEntries([
          ...[manifest.srcLang, ...manifest.locales].map((l) => [l, localizedPublicUrl(origin, l, slug, 'site')]),
          ['x-default', localizedPublicUrl(origin, manifest.srcLang, slug, 'site')],
        ])
      : undefined

  return {
    title,
    description,
    alternates: url ? { canonical: url, ...(languages ? { languages } : {}) } : undefined,
    openGraph: {
      title,
      description,
      url,
      images: ogImageUrl ? [ogImageUrl] : undefined,
    },
  }
}

export default async function SiteRoutePage({ params }: Props) {
  const { slug } = await params
  return <PublicSite slug={slug} />
}
