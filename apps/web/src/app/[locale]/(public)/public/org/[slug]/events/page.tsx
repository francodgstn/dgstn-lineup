'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ORG_SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import { usePublicEvents } from '@/components/events/program/usePublicEvents'
import { PublicEventList } from '@/components/events/program/PublicEventList'

export const dynamic = 'force-dynamic'

/** Resolve the org from the fully-public org_site_published snapshot — the same
 *  single read the org site page performs. An org without a published site has
 *  no public surface to hang events off. */
function usePublicOrgBySlug(slug: string) {
  const [state, setState] = useState<{ loading: boolean; orgId: string | null; name: string }>({
    loading: true, orgId: null, name: '',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, ORG_SITE_PUBLISHED_COLLECTION), where('slug', '==', slug), limit(1)),
        )
        if (cancelled) return
        const data = snap.empty ? null : (snap.docs[0].data() as { orgId: string; name: string })
        setState({ loading: false, orgId: data?.orgId ?? null, name: data?.name ?? '' })
      } catch {
        if (!cancelled) setState({ loading: false, orgId: null, name: '' })
      }
    })()
    return () => { cancelled = true }
  }, [slug])

  return state
}

// An organisation's own published events. The same events also appear on every
// member studio's public page (see usePublicEvents) — published once, shown in
// both places, which is the whole point for a federation.
export default function PublicOrgEventsIndexPage() {
  const t = useTranslations('EventProgram')
  const { slug } = useParams<{ slug: string }>()
  const org = usePublicOrgBySlug(slug)
  const { loading, events } = usePublicEvents(null, org.orgId)

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-8">
      <div className="space-y-1">
        {org.name && (
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{org.name}</p>
        )}
        <h1 className="text-2xl font-semibold">{t('publicEventsTitle')}</h1>
      </div>

      <PublicEventList
        events={events}
        loading={org.loading || loading}
        hrefFor={(event) => `/public/org/${slug}/events/${event.id}`}
      />
    </div>
  )
}
