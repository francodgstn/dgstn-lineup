import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import PublicSite from './PublicSite'

// Public website route. Full-bleed (no app/bio-link chrome) and reads only the
// fully-public site_published collection — structured to later lift onto a
// dedicated subdomain / custom domain with no data-model change.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true'

// Resolve the published site's public SEO fields by slug via the Firestore REST
// API. Deliberately NOT the web SDK: inside the Next server runtime the SDK's
// streamed query responses come back empty (fetch-stream buffering), which made
// every page title fall back to "Site not found". A single unauthenticated REST
// read (rules: public) is dependency-free and works in any server runtime.
interface RestValue {
  stringValue?: string
  mapValue?: { fields?: Record<string, RestValue> }
}
const str = (v?: RestValue) => v?.stringValue
const map = (v?: RestValue) => v?.mapValue?.fields ?? {}

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
    const rows = (await res.json()) as { document?: { fields?: Record<string, RestValue> } }[]
    const fields = rows.find((r) => r.document)?.document?.fields
    if (!fields) return null
    const meta = map(fields.meta)
    const seo = map(meta.seo)
    return {
      name: str(fields.name),
      title: str(meta.title),
      seoTitle: str(seo.title),
      description: str(seo.description),
      ogImageUrl: str(seo.ogImageUrl),
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
  const { slug } = await params
  const site = await fetchSiteMeta(slug)

  if (!site) {
    return { title: 'Site not found' }
  }

  // No configured base URL — derive the absolute origin from the request so the
  // canonical / og:url survive the future move to a custom domain.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const url = host ? `${proto}://${host}/public/${slug}/site` : undefined

  const title = site.seoTitle || site.title || site.name || slug
  const description = site.description
  const ogImageUrl = site.ogImageUrl

  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
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
