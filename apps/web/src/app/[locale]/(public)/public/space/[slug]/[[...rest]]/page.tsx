import { redirect } from 'next/navigation'
import type { Route } from 'next'

// Back-compat shim: Space moved from `/public/space/{slug}` to
// `/public/{slug}/space`. Redirect old links (incl. `/courses/{courseSlug}`),
// preserving any query string.
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

export default async function SpaceLegacyRedirect({ params, searchParams }: Props) {
  const { slug, rest } = await params
  const suffix = rest && rest.length ? `/${rest.join('/')}` : ''
  redirect(`/public/${slug}/space${suffix}${toQuery(await searchParams)}` as Route)
}
