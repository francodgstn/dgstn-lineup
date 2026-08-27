'use client'

/**
 * THE ORGANISATION IS A SCOPE, NOT A SECTION — so this layout is thin.
 *
 * It used to render eleven destinations in one horizontal tab strip with no
 * wrap and no scroll: about 1100–1400px of tabs in the ~1000px a 1280 viewport
 * leaves beside the sidebar, and unusable on a phone. The overflow was the
 * visible failure; the structural one was that eleven flat tabs are an entire
 * application's navigation, not a feature area's.
 *
 * Both halves of that now live where a studio's equivalents live: the four
 * working destinations are SIDEBAR ROWS (the shell renders them when the URL is
 * in org scope), and everything configurational is behind the RAIL below. The
 * strip and the "← Back to dashboard" link are gone — the second because it
 * framed the organisation as a modal detour rather than a place you work, which
 * is exactly the framing this design rejects.
 *
 * Full reasoning: docs/org-navigation.md. The catalogue: lib/org-nav.ts.
 */

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { OrgProvider, useOrg } from '@/contexts/OrgContext'
import { OrgRail } from '@/components/org/OrgRail'
import { orgItemForPath, orgRailSegment } from '@/lib/org-nav'

/**
 * The destination's own title.
 *
 * The deleted tab strip carried a header, and almost no org page has an `<h1>`
 * of its own — so removing the strip without this would have left ten pages
 * untitled. It names the DESTINATION, not the organisation: which org you are
 * in is a property of the scope, said once and persistently by the sidebar's
 * indicator, and repeating it on every page is the noise the scope model exists
 * to remove.
 */
function OrgPageHeading({ pathname }: { pathname: string }) {
  const t = useTranslations('Org')
  const { affiliationTerm } = useOrg()
  const item = orgItemForPath(pathname)
  if (!item || item.ownsHeader) return null
  const label =
    item.dynamicLabel === 'affiliationTerm'
      ? affiliationTerm
      : t(item.labelKey as Parameters<typeof t>[0])
  return <h1 className="mb-4 text-2xl font-semibold">{label}</h1>
}

function OrgShell({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const t = useTranslations('Org')
  const pathname = usePathname()
  const onRailRoute = orgRailSegment(pathname) !== null

  // A sidebar row renders full-width, exactly as a studio's own pages do. Only
  // the rail destinations get the master-detail shell.
  if (!onRailRoute) {
    return (
      <>
        <OrgPageHeading pathname={pathname} />
        {children}
      </>
    )
  }

  return (
    <div className="md:flex md:gap-8">
      {/* MOBILE: the rail is a DISCLOSURE above the detail, not a separate index
          page. The studio rail can be an index because /settings is a real route
          that lists it; the organisation has no equivalent — /org/{id} redirects
          straight to the studios list — and inventing one would put a second
          "organisation home" in the reader's head for a scope that already has
          one. Closed by default so the detail is still the page you landed on. */}
      <aside className="md:w-60 md:shrink-0">
        <details className="mb-4 rounded-lg border p-3 md:hidden">
          <summary className="cursor-pointer text-sm font-medium">{t('manageTitle')}</summary>
          <div className="pt-3">
            <OrgRail orgId={orgId} />
          </div>
        </details>
        <div className="hidden md:sticky md:top-6 md:block">
          <OrgRail orgId={orgId} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <OrgPageHeading pathname={pathname} />
        {children}
      </div>
    </div>
  )
}

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>()
  return (
    <OrgProvider orgId={orgId}>
      <OrgShell orgId={orgId}>{children}</OrgShell>
    </OrgProvider>
  )
}
