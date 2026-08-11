import { parseDocId, parsePublicFrom } from '@linyup/shared'
import AppointmentPicker from './AppointmentPicker'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ activity?: string; from?: string }>
}

// Reads the query server-side (same pattern as the booking route) so the picker
// never needs a client useSearchParams()/Suspense boundary.
export default async function AppointmentPickerPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { activity, from } = await searchParams
  return (
    <AppointmentPicker
      slug={slug}
      presetActivityId={parseDocId(activity)}
      from={parsePublicFrom(from)}
    />
  )
}
