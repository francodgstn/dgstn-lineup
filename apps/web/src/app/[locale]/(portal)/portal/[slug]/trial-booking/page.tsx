import { collectionGroup, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { notFound } from 'next/navigation'
import TrialBookingForm from './TrialBookingForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function TrialBookingPage({ params }: Props) {
  const { slug } = await params

  // Resolve team via public_profile collection group (public read allowed)
  const q = query(
    collectionGroup(db, 'public_profile'),
    where('slug', '==', slug),
    limit(1),
  )
  const snap = await getDocs(q)
  if (snap.empty) notFound()

  const profileDoc = snap.docs[0]
  // teamId is the parent of the public_profile subcollection
  const teamId = profileDoc.ref.parent.parent?.id
  if (!teamId) notFound()

  const data = profileDoc.data()
  const teamName: string = data.name || 'Team'

  return <TrialBookingForm teamId={teamId} teamName={teamName} />
}
