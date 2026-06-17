import { redirect } from 'next/navigation'
import type { Route } from 'next'

// Back-compat shim: the public website moved from `/public/site/{slug}` to
// `/public/{slug}/site`. Redirect old links, preserving any query string.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
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

export default async function SiteLegacyRedirect({ params, searchParams }: Props) {
  const { slug } = await params
  redirect(`/public/${slug}/site${toQuery(await searchParams)}` as Route)
}
