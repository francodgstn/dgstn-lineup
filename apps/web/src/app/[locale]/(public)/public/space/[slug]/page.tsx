import { collectionGroup, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import SpaceHome from './SpaceHome'
import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; locale: string }>
}

export default async function SpacePage({ params }: Props) {
  const { slug, locale } = await params
  const t = await getTranslations({ locale, namespace: 'Space' })

  // Resolve teamId (same query as layout; needed here to pass to SpaceHome)
  let teamId: string | null = null
  try {
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('slug', '==', slug),
      where('type', '==', 'team'),
      limit(1)
    )
    const snap = await getDocs(q)
    if (!snap.empty) {
      teamId = snap.docs[0].ref.parent.parent?.id ?? null
    }
  } catch {
    // leave teamId null
  }

  if (!teamId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className="text-lg font-semibold">{t('notFound')}</p>
        <p className="text-sm text-muted-foreground">{t('notFoundDesc')}</p>
      </div>
    )
  }

  return <SpaceHome slug={slug} teamId={teamId} />
}
