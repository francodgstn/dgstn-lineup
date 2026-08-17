import type { Metadata } from 'next'
import { fetchPublicTeamMeta, robotsFor } from '@/lib/publicTeamMeta'
import { DocumentsIndex } from './DocumentsIndex'

// A SERVER shell around a client page, for one reason: `generateMetadata` cannot
// live in a `'use client'` module, and the `noindex` this route needs has to be
// in the HTML a crawler is served — a robots tag written by client JavaScript is
// not a mechanism, it is a hope.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const team = await fetchPublicTeamMeta(slug)
  return {
    title: team ? `Documents — ${team.name}` : 'Documents',
    robots: robotsFor(team),
  }
}

export default function PublicDocumentsIndexPage() {
  return <DocumentsIndex />
}
