import { redirect } from 'next/navigation'
import type { Route } from 'next'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function TrialBookingRedirectPage({ params }: Props) {
  const { slug } = await params
  redirect(`/public/bio-link/${slug}/booking` as Route)
}
