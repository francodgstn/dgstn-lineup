import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { notFound } from 'next/navigation'
import type { TeamPublicProfile } from '@lineup/shared'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function TeamPortalPage({ params }: Props) {
  const { slug } = await params

  const snap = await getDocs(query(collection(db, 'teams'), where('slug', '==', slug)))
  if (snap.empty) notFound()

  const team = snap.docs[0].data() as TeamPublicProfile
  const bookingLink = team.links?.find((l) => l.isBookingLink)
  const membershipLink = team.links?.find((l) => l.isMembershipLink)

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{team.name}</h1>
        {team.description && <p className="text-muted-foreground">{team.description}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {bookingLink && (
          <a
            href={`/portal/${slug}/trial-booking`}
            className="block bg-primary text-primary-foreground rounded-xl p-6 hover:bg-primary/90 transition-colors"
          >
            <p className="font-semibold text-lg">{bookingLink.label}</p>
            {bookingLink.description && (
              <p className="text-primary-foreground/80 text-sm mt-1">{bookingLink.description}</p>
            )}
          </a>
        )}

        {membershipLink && (
          <a
            href={`/portal/${slug}/membership-signup`}
            className="block bg-card border rounded-xl p-6 hover:bg-muted/50 transition-colors"
          >
            <p className="font-semibold text-lg">{membershipLink.label}</p>
            {membershipLink.description && (
              <p className="text-muted-foreground text-sm mt-1">{membershipLink.description}</p>
            )}
          </a>
        )}
      </div>
    </div>
  )
}
