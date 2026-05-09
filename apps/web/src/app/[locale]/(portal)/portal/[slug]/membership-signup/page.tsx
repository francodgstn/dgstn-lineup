import { collectionGroup, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { notFound } from 'next/navigation'
import MembershipSignupForm from './MembershipSignupForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function MembershipSignupPage({ params }: Props) {
  const { slug } = await params

  const q = query(
    collectionGroup(db, 'public_profile'),
    where('slug', '==', slug),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) notFound()

  const profileDoc = snap.docs[0]
  const teamId = profileDoc.ref.parent.parent?.id
  if (!teamId) notFound()

  const data = profileDoc.data()
  const teamName: string = data.name || 'Team'

  return <MembershipSignupForm teamId={teamId} teamName={teamName} slug={slug} />
}
