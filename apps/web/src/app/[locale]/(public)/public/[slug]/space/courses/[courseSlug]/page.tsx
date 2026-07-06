import CoursePlayer from './CoursePlayer'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; courseSlug: string; locale: string }>
  searchParams: Promise<{ from?: string }>
}

// courseId is resolved client-side in CoursePlayer (no server-side Firebase reads).
// `from` records where the visitor opened the course (e.g. 'shop') so the back link
// returns there instead of always to the Space.
export default async function CourseSpacePage({ params, searchParams }: Props) {
  const { courseSlug } = await params
  const { from } = await searchParams
  return <CoursePlayer courseSlug={courseSlug} from={from} />
}
