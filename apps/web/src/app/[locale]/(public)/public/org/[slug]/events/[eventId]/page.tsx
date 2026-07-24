'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ORG_SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import { usePublicEvent } from '@/components/events/program/usePublicEvents'
import { PublicEventDetail } from '@/components/events/program/PublicEventDetail'

export const dynamic = 'force-dynamic'

function usePublicOrgIdBySlug(slug: string) {
  const [state, setState] = useState<{ loading: boolean; orgId: string | null }>({
    loading: true, orgId: null,
  })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, ORG_SITE_PUBLISHED_COLLECTION), where('slug', '==', slug), limit(1)),
        )
        if (cancelled) return
        const data = snap.empty ? null : (snap.docs[0].data() as { orgId: string })
        setState({ loading: false, orgId: data?.orgId ?? null })
      } catch {
        if (!cancelled) setState({ loading: false, orgId: null })
      }
    })()
    return () => { cancelled = true }
  }, [slug])
  return state
}

export default function PublicOrgEventDetailPage() {
  const t = useTranslations('EventProgram')
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>()
  const org = usePublicOrgIdBySlug(slug)
  const { loading, event } = usePublicEvent(eventId)

  // The mirror is world-readable by id, so confirm the event really belongs to
  // THIS organisation before rendering it under the org's slug.
  const belongsHere = !!event && !!org.orgId && event.orgId === org.orgId

  if (org.loading || loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 px-4 py-8">
        <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
      </div>
    )
  }

  if (!event || !belongsHere) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">{t('publicEventNotFound')}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <PublicEventDetail
        event={event}
        backHref={`/public/org/${slug}/events`}
        backLabel={t('publicBackToEvents')}
      />
    </div>
  )
}
