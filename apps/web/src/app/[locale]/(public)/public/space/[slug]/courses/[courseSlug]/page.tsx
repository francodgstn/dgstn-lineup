import { collectionGroup, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import CoursePlayer from './CoursePlayer'
import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; courseSlug: string; locale: string }>
}

export default async function CourseSpacePage({ params }: Props) {
  const { slug, courseSlug, locale } = await params
  const t = await getTranslations({ locale, namespace: 'Space' })

  // Resolve courseId from public_profile collectionGroup
  let courseId: string | null = null
  try {
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('type', '==', 'course'),
      where('slug', '==', courseSlug)
    )
    const snap = await getDocs(q)
    if (!snap.empty) {
      // The public_profile doc lives at courses/{courseId}/public_profile/{docId}
      courseId = snap.docs[0].ref.parent.parent?.id ?? null
    }
  } catch {
    // leave courseId null
  }

  if (!courseId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className="text-lg font-semibold">{t('notFound')}</p>
      </div>
    )
  }

  return <CoursePlayer courseId={courseId} slug={slug} />
}
