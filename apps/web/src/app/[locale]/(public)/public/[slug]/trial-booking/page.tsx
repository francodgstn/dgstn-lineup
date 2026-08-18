import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { publicPath } from '@linyup/shared'
import { toQuery } from '@/lib/publicRoutes'

export const dynamic = 'force-dynamic'

// Back-compat shim: trial booking is just booking now. The query MUST ride
// through — old links carry `?activity=`/`?date=`, and dropping them landed the
// visitor on the blank picker, which is exactly what those params exist to avoid.
interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function TrialBookingRedirectPage({ params, searchParams }: Props) {
  const { slug } = await params
  redirect(`${publicPath(slug, 'booking')}${toQuery(await searchParams)}` as Route)
}
