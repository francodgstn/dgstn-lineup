import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ORG_SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import type { OrgPublishedSite } from '@linyup/shared'
import PublicOrgSite from './PublicOrgSite'

// Public organization website route. Sibling to the team site's static `org`
// segment sitting alongside the dynamic team `/[slug]` root — Next resolves the
// static `org` segment first, so there's no collision. Full-bleed (no app/
// bio-link chrome) and reads only the fully-public org_site_published
// collection. Mirrors (public)/public/[slug]/site/page.tsx.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

// Resolve a published org site by slug from the fully-public
// org_site_published collection. No auth and no restricted data, so the
// modular client SDK runs fine in this server (generateMetadata) context.
// Mirrors the single read the client PublicOrgSite component performs.
async function fetchPublishedOrgSite(slug: string): Promise<OrgPublishedSite | null> {
  try {
    const snap = await getDocs(
      query(collection(db, ORG_SITE_PUBLISHED_COLLECTION), where('slug', '==', slug), limit(1))
    )
    return snap.empty ? null : (snap.docs[0].data() as OrgPublishedSite)
  } catch {
    return null
  }
}

// Emit real SEO / OpenGraph tags into <head> from the published site's stored
// meta.seo (the client renderer never touches the document head).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const site = await fetchPublishedOrgSite(slug)

  if (!site) {
    return { title: 'Site not found' }
  }

  // No configured base URL — derive the absolute origin from the request so the
  // canonical / og:url survive the future move to a custom domain.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const url = host ? `${proto}://${host}/org/${slug}` : undefined

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

export default async function OrgSiteRoutePage({ params }: Props) {
  const { slug } = await params
  return <PublicOrgSite slug={slug} />
}
