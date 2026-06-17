import CoursePlayer from './CoursePlayer'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; courseSlug: string; locale: string }>
}

// courseId is resolved client-side in CoursePlayer (no server-side Firebase reads).
export default async function CourseSpacePage({ params }: Props) {
  const { courseSlug } = await params
  return <CoursePlayer courseSlug={courseSlug} />
}
