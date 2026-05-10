import PortalHome from './PortalHome'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function TeamPortalPage({ params }: Props) {
  const { slug } = await params
  return <PortalHome slug={slug} />
}
