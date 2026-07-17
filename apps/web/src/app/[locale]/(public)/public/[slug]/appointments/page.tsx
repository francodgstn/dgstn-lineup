import AppointmentPicker from './AppointmentPicker'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ activity?: string }>
}

// Reads `?activity=` server-side (same pattern as the booking route's `?date=`)
// so the picker never needs a client useSearchParams()/Suspense boundary.
export default async function AppointmentPickerPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { activity } = await searchParams
  return <AppointmentPicker slug={slug} presetActivityId={activity} />
}
