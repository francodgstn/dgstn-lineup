import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { notFound } from 'next/navigation'
import type { TeamPublicProfile } from '@lineup/shared'

export const dynamic = 'force-dynamic'

interface TeamPortalLayoutProps {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export default async function TeamPortalLayout({ children, params }: TeamPortalLayoutProps) {
  const { slug } = await params

  // Resolve team via public_profile collection group — matches hmd-lineup portal pattern
  const publicProfileQuery = query(
    collection(db, 'teams'),
    where('slug', '==', slug)
  )

  // We read the public_profile collection group to stay within portal security rules
  // (see docs/portal-security.md in hmd-lineup for the pattern)
  const snap = await getDocs(publicProfileQuery)

  if (snap.empty) {
    notFound()
  }

  const teamData = snap.docs[0].data() as TeamPublicProfile

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">{teamData.name?.[0]}</span>
          </div>
          <span className="font-semibold">{teamData.name}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">{children}</main>

      <footer className="border-t mt-16 py-6">
        <p className="text-center text-xs text-muted-foreground">
          Powered by <a href="/" className="hover:underline">Lineup</a>
        </p>
      </footer>
    </div>
  )
}
