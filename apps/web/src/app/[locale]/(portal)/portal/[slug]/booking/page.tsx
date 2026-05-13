import BookingForm from './BookingForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ date?: string }>
}

export default async function BookingPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { date } = await searchParams
  return <BookingForm slug={slug} initialDate={date} />
}
