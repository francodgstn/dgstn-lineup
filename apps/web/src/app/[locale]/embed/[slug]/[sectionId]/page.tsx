import EmbedSection from './EmbedSection'

// Single-section embed endpoint — renders ONE published website section,
// chrome-less and framable, so a studio can iframe it into their own external
// site. Framing is allowed for these paths in src/proxy.ts; the resizer lives in
// public/embed.js. Reads only the fully-public site_published snapshot.
//
// Lives directly under [locale] (NOT the (public) group) so it skips the demo
// AnnouncementBar and PublicTeamProvider — an embed needs neither.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; sectionId: string }>
}

export default async function EmbedPage({ params }: Props) {
  const { slug, sectionId } = await params
  return <EmbedSection slug={slug} sectionId={sectionId} />
}
