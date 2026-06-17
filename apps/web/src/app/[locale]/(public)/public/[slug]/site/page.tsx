import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import type { PublishedSite } from '@linyup/shared'
import PublicSite from './PublicSite'

// Public website route. Full-bleed (no app/bio-link chrome) and reads only the
// fully-public site_published collection — structured to later lift onto a
// dedicated subdomain / custom domain with no data-model change.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

// Resolve a published site by slug from the fully-public site_published
// collection. No auth and no restricted data, so the modular client SDK runs
// fine in this server (generateMetadata) context. Mirrors the single read the
// client PublicSite component performs.
async function fetchPublishedSite(slug: string): Promise<PublishedSite | null> {
  try {
    const snap = await getDocs(
      query(collection(db, SITE_PUBLISHED_COLLECTION), where('slug', '==', slug), limit(1))
    )
    return snap.empty ? null : (snap.docs[0].data() as PublishedSite)
  } catch {
    return null
  }
}

// Emit real SEO / OpenGraph tags into <head> from the published site's stored
// meta.seo (the client renderer never touches the document head).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const site = await fetchPublishedSite(slug)

  if (!site) {
    return { title: 'Site not found' }
  }

  // No configured base URL — derive the absolute origin from the request so the
  // canonical / og:url survive the future move to a custom domain.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const url = host ? `${proto}://${host}/public/${slug}/site` : undefined

  const { seo } = site.meta
  const title = seo?.title || site.meta.title || site.name
  const description = seo?.description
  const ogImageUrl = seo?.ogImageUrl

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
