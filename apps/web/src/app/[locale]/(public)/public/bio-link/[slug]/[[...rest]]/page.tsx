import { redirect } from 'next/navigation'
import type { Route } from 'next'

// Back-compat shim: the bio-link is now the team root at `/public/{slug}` and its
// former sub-routes (booking, signup, …) are siblings. Redirect any old
// `/public/bio-link/{slug}/…` link to the new tenant-first path, query preserved.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string; rest?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toQuery(sp: Record<string, string | string[] | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x))
    else p.append(k, v)
  }
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export default async function BioLinkLegacyRedirect({ params, searchParams }: Props) {
  const { slug, rest } = await params
  const suffix = rest && rest.length ? `/${rest.join('/')}` : ''
  redirect(`/public/${slug}${suffix}${toQuery(await searchParams)}` as Route)
}
