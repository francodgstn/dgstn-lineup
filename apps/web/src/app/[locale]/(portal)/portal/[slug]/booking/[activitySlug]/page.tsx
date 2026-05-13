import BookingForm from '../BookingForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; activitySlug: string }>
  searchParams: Promise<{ date?: string }>
}

export default async function BookingActivityPage({ params, searchParams }: Props) {
  const { slug, activitySlug } = await params
  const { date } = await searchParams
  return <BookingForm slug={slug} preSelectedActivitySlug={activitySlug} initialDate={date} />
}