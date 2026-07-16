import AppointmentPicker from './AppointmentPicker'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function AppointmentPickerPage({ params }: Props) {
  const { slug } = await params
  return <AppointmentPicker slug={slug} />
}
