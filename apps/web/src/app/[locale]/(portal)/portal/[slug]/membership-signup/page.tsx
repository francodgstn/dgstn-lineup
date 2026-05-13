import { redirect } from 'next/navigation'
import type { Route } from 'next'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function MembershipSignupPage({ params }: Props) {
  const { slug } = await params
  redirect(`/portal/${slug}/signup` as Route)
}
