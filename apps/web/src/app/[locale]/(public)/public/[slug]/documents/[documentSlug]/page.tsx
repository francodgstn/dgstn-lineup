import type { Metadata } from 'next'
import { fetchPublicDocumentMeta, fetchPublicTeamMeta, robotsFor } from '@/lib/publicTeamMeta'
import { DocumentDetail } from './DocumentDetail'

// Server shell — see the sibling index page. The document's own title is
// resolved here too, because on a paid tier this page IS indexable and a page
// worth indexing needs a real <title>; on every other tier the same read decides
// the `noindex`.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; documentSlug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, documentSlug } = await params
  const team = await fetchPublicTeamMeta(slug)
  const doc = team ? await fetchPublicDocumentMeta(team.teamId, documentSlug) : null
  return {
    title: doc && team ? `${doc.title} — ${team.name}` : 'Document',
    description: doc?.summary ?? undefined,
    robots: robotsFor(team),
  }
}

export default function PublicDocumentDetailPage() {
  return <DocumentDetail />
}
