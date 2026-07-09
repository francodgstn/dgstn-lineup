'use client'

import { useEffect, useState } from 'react'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ORG_SITE_PUBLISHED_COLLECTION } from '@linyup/shared'
import type { OrgPublishedSite } from '@linyup/shared'
import WebsiteRenderer from '@/components/site/WebsiteRenderer'

// Resolves a published org site by slug from the fully-public
// org_site_published collection — no auth, no restricted data. This is the
// single read a future headless website app (subdomain / custom domain) would
// perform. Mirrors (public)/public/[slug]/site/PublicSite.tsx.
export default function PublicOrgSite({ slug }: { slug: string }) {
  const [site, setSite] = useState<OrgPublishedSite | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(
      collection(db, ORG_SITE_PUBLISHED_COLLECTION),
      where('slug', '==', slug),
      limit(1)
    )
    getDocs(q)
      .then((snap) => {
        if (!snap.empty) setSite(snap.docs[0].data() as OrgPublishedSite)
      })
      .catch(() => {
        /* leave null → not-found */
      })
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!site) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-lg font-semibold">Site not found</p>
        <p className="text-sm text-muted-foreground">No published website exists at this URL.</p>
      </div>
    )
  }

  return <WebsiteRenderer site={site} orgId={site.orgId} orgTeams={site.teams} />
}
