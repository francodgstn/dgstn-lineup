import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { fetchTeamPublicMeta } from '@/lib/publicMetaRest'
import BioLinkRoot from './BioLinkRoot'

// Team root — the bio-link. THE ONE ARTIFACT MEANT TO BE SHARED (UX-31).
//
// It is pasted into an Instagram bio, a WhatsApp message, a QR code on a flyer.
// Until this file existed it emitted no metadata of its own, so every one of
// those places unfurled it as the app-wide default from the root layout —
// "Linyup", the platform's own description, no image — or, where a client shows
// nothing without an og:image, as the bare URL. A studio's own link advertised
// its software vendor.
//
// What a shared bio-link now shows: the STUDIO'S name as the title, its public
// description as the summary, and its cover (or profile) photo as the preview
// image — the same three things a visitor sees at the top of the page they land
// on, which is the point: the preview must look like what they will get.
//
// The rendering stays client-side (BioLinkRoot reads the team from
// PublicTeamProvider); this wrapper only adds the <head>.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const team = await fetchTeamPublicMeta(slug)
  // No profile resolved (bad slug, or the read failed — it logs) — fall through
  // to the root layout's defaults rather than asserting a name we do not have.
  if (!team?.name) return {}

  // No configured base URL — derive the absolute origin from the request, the
  // same way the published website's metadata does, so og:url survives a move
  // to a custom domain.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const url = host ? `${proto}://${host}/public/${slug}` : undefined

  // The cover leads: it is the wide image the studio chose for the top of the
  // page, and it is the shape a link preview crops to. The round profile photo
  // is the fallback rather than the default for the same reason.
  const image = team.heroImage || team.profileImage

  return {
    title: team.name,
    description: team.description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      type: 'website',
      title: team.name,
      description: team.description,
      url,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: team.name,
      description: team.description,
      images: image ? [image] : undefined,
    },
  }
}

export default function PublicTeamRootPage() {
  return <BioLinkRoot />
}
