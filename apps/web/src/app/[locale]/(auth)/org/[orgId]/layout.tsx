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
import { Link, usePathname } from '@/i18n/navigation'
import { OrgProvider, useOrg } from '@/contexts/OrgContext'
import { OrgRail } from '@/components/org/OrgRail'
import { ChevronLeft } from 'lucide-react'
import type { Route } from 'next'
import { ORG_MANAGE_PATH, isOrgManageRoot, orgHref, orgItemForPath, orgRailSegment } from '@/lib/org-nav'

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
  const { userRole, loading: roleLoading } = useOrg()

  // A MEMBER STUDIO HAS NO RAIL.
  //
  // Whether to render the management shell was decided from the PATHNAME alone,
  // so somebody with no seat in the organisation — arriving at `/org/{id}/ranking`
  // from Settings → Team, which is a legitimate link — was handed the rail and
  // with it every destination `ORG_STUDIO_NAV_ITEMS` deliberately withholds
  // (Franco, 2026-08-28). `OrgRail` filters `adminOnly`, which separates an
  // org_admin from an org_viewer; it cannot separate either from a person who is
  // not a member at all, and that is a different question — so it is answered
  // here, beside the decision to render the shell in the first place.
  //
  // The page itself still renders, full width with its own heading: those links
  // promise the ranking scale, and the scale is genuinely readable by a member
  // studio (`firestore.rules` admits `currentTeamInOrg` to the org document).
  const onRailRoute = orgRailSegment(pathname) !== null && userRole != null

  // WAIT rather than guess. On a rail route the shell would otherwise render
  // for a beat and then vanish once the role arrives, which reads as the app
  // taking something away.
  if (roleLoading && orgRailSegment(pathname) !== null) return null

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

  // `/manage` is the rail's own index, exactly as `/settings` is the studio's:
  // on a phone the rail IS that page and the detail is hidden; on a section the
  // detail is the page and the rail is hidden. Desktop always shows both.
  //
  // This replaced a mobile DISCLOSURE that existed only because the org had no
  // index route to be the index of. It does now, so the org rail behaves like
  // the studio one instead of like a special case.
  const isRailRoot = isOrgManageRoot(pathname)

  return (
    <div className="md:flex md:gap-8">
      <aside className={`md:w-60 md:shrink-0 ${isRailRoot ? 'block' : 'hidden md:block'}`}>
        <div className="md:sticky md:top-6">
          <OrgRail orgId={orgId} />
        </div>
      </aside>

      <div className={`min-w-0 flex-1 ${isRailRoot ? 'hidden md:block' : 'block'}`}>
        {!isRailRoot && (
          <Link
            href={orgHref(orgId, ORG_MANAGE_PATH) as Route}
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('manageTitle')}
          </Link>
        )}
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
