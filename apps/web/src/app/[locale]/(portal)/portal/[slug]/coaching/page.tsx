import CoachingPortal from './CoachingPortal'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function CoachingPortalPage({ params }: Props) {
  const { slug } = await params
  return <CoachingPortal slug={slug} />
}
