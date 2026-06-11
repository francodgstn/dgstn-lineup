import BioLinkHome from './BioLinkHome'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function BioLinkPage({ params }: Props) {
  const { slug } = await params
  return <BioLinkHome slug={slug} />
}
