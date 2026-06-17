import CoachingBioLink from './CoachingBioLink'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function CoachingBioLinkPage({ params }: Props) {
  const { slug } = await params
  return <CoachingBioLink slug={slug} />
}
