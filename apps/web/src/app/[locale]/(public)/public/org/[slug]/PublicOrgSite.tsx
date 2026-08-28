'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, query, where, limit, getDocs } from 'firebase/firestore'
import { useLocale, useTranslations } from 'next-intl'
import { db } from '@/lib/firebase'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
import { ORG_SITE_PUBLISHED_COLLECTION, applySiteTranslations, siteI18nDocId } from '@linyup/shared'
import type { OrgPublishedSite, SiteTranslationDoc, SiteTranslationUnits } from '@linyup/shared'
import WebsiteRenderer from '@/components/site/WebsiteRenderer'

// Resolves a published org site by slug from the fully-public
// org_site_published collection — no auth, no restricted data. This is the
// single read a future headless website app (subdomain / custom domain) would
// perform. Mirrors (public)/public/[slug]/site/PublicSite.tsx.
export default function PublicOrgSite({ slug }: { slug: string }) {
  const locale = useLocale()
  const t = useTranslations('Site')
  const [site, setSite] = useState<OrgPublishedSite | null>(null)
  const [i18nUnits, setI18nUnits] = useState<SiteTranslationUnits | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function run() {
      let base: OrgPublishedSite | null = null
      try {
        const snap = await getDocs(
          query(collection(db, ORG_SITE_PUBLISHED_COLLECTION), where('slug', '==', slug), limit(1))
        )
        if (!snap.empty) base = snap.docs[0].data() as OrgPublishedSite
      } catch (err: unknown) {
        reportPublicLoadFailure('org-site/published', err) // terminal not-found, but never silent
      }
      if (cancelled) return
      // Fetch the sidecar (if any) BEFORE first paint, in the same loading
      // state as the base fetch — see the team-site twin for why, including
      // the per-run local `units` (a locale switch does not remount this
      // component, so state must be re-resolved, never accreted).
      let units: SiteTranslationUnits | null = null
      const manifest = base?.i18n
      if (base && manifest && locale !== manifest.srcLang && manifest.locales.includes(locale as (typeof manifest.locales)[number])) {
        try {
          const sidecarSnap = await getDoc(
            doc(db, ORG_SITE_PUBLISHED_COLLECTION, siteI18nDocId(base.orgId, locale))
          )
          if (sidecarSnap.exists()) {
            units = (sidecarSnap.data() as SiteTranslationDoc).units
          }
        } catch (err: unknown) {
          reportPublicLoadFailure('org-site/i18n-sidecar', err) // falls back to base-language text
        }
      }
      if (cancelled) return
      setSite(base)
      setI18nUnits(units)
      setLoading(false)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [slug, locale])

  // The ONE resolver (packages/shared) — never re-derive translated fields here.
  const translatedSite = useMemo(() => (site ? applySiteTranslations(site, i18nUnits) : null), [site, i18nUnits])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!translatedSite) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-lg font-semibold">{t('notFoundTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('notFoundBody')}</p>
      </div>
    )
  }

  return <WebsiteRenderer site={translatedSite} orgId={translatedSite.orgId} orgTeams={translatedSite.teams} />
}
