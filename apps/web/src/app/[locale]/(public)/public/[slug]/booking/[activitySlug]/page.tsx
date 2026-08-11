import { parseDateKey, parseDocId, parsePublicFrom, parseSlug } from '@linyup/shared'
import BookingForm from '../BookingForm'

export const dynamic = 'force-dynamic'

// Activity-scoped entry. The path segment is an INBOUND ALIAS only — the wizard
// never navigates to it, so every step stays on one pathname. See ../page.tsx
// for the full param contract.
interface Props {
  params: Promise<{ slug: string; activitySlug: string }>
  searchParams: Promise<{
    date?: string
    session?: string
    referral?: string
    from?: string
  }>
}

export default async function BookingActivityPage({ params, searchParams }: Props) {
  const { slug, activitySlug } = await params
  const { date, session, referral, from } = await searchParams
  return (
    <BookingForm
      slug={slug}
      preSelectedActivitySlug={parseSlug(activitySlug)}
      initialDate={parseDateKey(date)}
      initialSession={parseDocId(session)}
      referral={parseDocId(referral)}
      from={parsePublicFrom(from)}
    />
  )
}
