// The organisation's own navigation catalogue — the org-scope twin of
// `settings-nav.ts`, and shaped like it on purpose so the rail and the sidebar
// can read both through the same components.
//
// ─── WHY THE ORG HAS TWO LISTS AND NOT ONE STRIP ────────────────────────────
//
// It used to have eleven destinations in a single horizontal tab strip with no
// wrap and no scroll, which overflowed an ordinary laptop and was unreachable on
// a phone. The overflow was the visible failure; the structural one was that a
// flat list of eleven treats "today's events" and "billing" as equals, which is
// what made it eleven long.
//
// So the org gets the same SHAPE a studio has: a few sidebar rows for the work,
// and a rail for everything configurational. The split below is the whole
// design — see docs/org-navigation.md.
//
// EVERY HREF HERE IS AN EXISTING ROUTE. Nothing moved on disk, so there is no
// redirect map and no link rot; `/org/{id}/teams` in particular keeps its URL
// even though its LABEL becomes "Studios", because the product's own vocabulary
// is "studio" everywhere else and the segment is in the world.

import {
  Blocks,
  Building2,
  CalendarRange,
  CreditCard,
  Globe,
  IdCard,
  ListTodo,
  MapPin,
  Settings,
  Settings2,
  Shield,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Where an org destination lives: a sidebar row, or a group in the rail. */
export type OrgRailGroupKey = 'standards' | 'shared' | 'administration'

export interface OrgNavItem {
  /** Stable id — React key, and the key the search keyword index is under. */
  id: string
  /** Path AFTER `/org/{orgId}`, with no leading slash. */
  path: string
  /** Key in the `Org` i18n namespace. */
  labelKey: string
  icon: LucideIcon
  /** Which rail group it belongs to. Absent for the four sidebar rows. */
  group?: OrgRailGroupKey
  /**
   * The PAGE renders its own title, so the layout must not add a second one.
   *
   * Every org page used to be titled by the tab strip's header and almost none
   * carried an `<h1>` of its own; deleting the strip would have left them
   * untitled. The layout supplies the heading instead — except for the two that
   * always had one, which say so here rather than being remembered.
   */
  ownsHeader?: boolean
  /**
   * Rendered with the tenant's own word for it rather than the static label —
   * an organisation renames "Affiliations" (`Organization.affiliation_term`),
   * and the rail reads it off `useOrg`. The static key stays as the fallback
   * for the moment before the org document has loaded.
   */
  dynamicLabel?: 'affiliationTerm'
  /**
   * Org-admin only. NAVIGATION, NEVER ENFORCEMENT — the pages and the rules
   * both do their own checking; hiding a row a member studio cannot act on just
   * keeps the rail honest, exactly as `SettingsGate.ownerOnly` does for a team.
   */
  adminOnly?: boolean
}

/**
 * THE SIDEBAR ROWS — what somebody opens while doing the organisation's work.
 *
 * Four, and the test for membership is "would a federation administrator open
 * this during a working day". Programme templates sits beside Events because it
 * is read while creating one; Website is authoring, exactly as a studio's
 * Website is a sidebar row rather than a setting.
 */
export const ORG_NAV_ITEMS: OrgNavItem[] = [
  { id: 'org-teams', path: 'teams', labelKey: 'navStudios', icon: Building2 },
  { id: 'org-events', path: 'events', labelKey: 'tabEvents', icon: CalendarRange },
  { id: 'org-program-templates', path: 'program-templates', labelKey: 'tabProgramTemplates', icon: ListTodo },
  { id: 'org-website', path: 'website', labelKey: 'tabWebsite', icon: Globe, ownsHeader: true },
  // THE WAY IN TO THE RAIL, and the reason it is a row rather than a menu item.
  //
  // The rail rendered only on rail ROUTES, which is a chicken and egg: from
  // Studios or Events there was no rail and no link to any of the seven
  // destinations behind it. A studio does not have this problem because
  // `/settings` is a real place you can go to; the organisation had no
  // equivalent, so eleven tabs became four rows and seven things that had
  // apparently vanished (Franco, 2026-08-27: "where did all the tabs go?").
  //
  // `/manage` is that place. It is also what makes the rail work on a phone,
  // where a rail is an INDEX rather than a column beside a detail pane — the
  // same shape `/settings` has.
  { id: 'org-manage', path: 'manage', labelKey: 'manageTitle', icon: Settings2, ownsHeader: true },
]

/**
 * THE RAIL — everything configurational, grouped.
 *
 * The grouping is not cosmetic. The first group is what an organisation IMPOSES
 * on its member studios, and it is already literally that in the data: an org's
 * `ranking_systems` override a studio's, and the affiliation types are the org's
 * to define. The second is what it LENDS them. The third is about the
 * organisation itself rather than about its studios.
 */
export const ORG_RAIL_ITEMS: (OrgNavItem & { group: OrgRailGroupKey })[] = [
  { id: 'org-ranking', path: 'ranking', labelKey: 'tabRanking', icon: Shield, group: 'standards' },
  {
    id: 'org-affiliations',
    path: 'affiliations',
    labelKey: 'tabAffiliations',
    icon: IdCard,
    group: 'standards',
    dynamicLabel: 'affiliationTerm',
  },
  { id: 'org-places', path: 'places', labelKey: 'tabPlaces', icon: MapPin, group: 'shared', ownsHeader: true },
  { id: 'org-members', path: 'members', labelKey: 'tabMembers', icon: Users, group: 'administration', adminOnly: true },
  { id: 'org-plugins', path: 'plugins', labelKey: 'tabPlugins', icon: Blocks, group: 'administration', adminOnly: true },
  { id: 'org-billing', path: 'billing', labelKey: 'tabBilling', icon: CreditCard, group: 'administration', adminOnly: true },
  { id: 'org-settings', path: 'settings', labelKey: 'tabSettings', icon: Settings, group: 'administration', adminOnly: true },
]

/** Group order in the rail, with the `Org` i18n key for each heading. */
export const ORG_RAIL_GROUPS: { key: OrgRailGroupKey; labelKey: string }[] = [
  { key: 'standards', labelKey: 'railGroupStandards' },
  { key: 'shared', labelKey: 'railGroupShared' },
  { key: 'administration', labelKey: 'railGroupAdministration' },
]

/** `/org/{orgId}/{path}` — the one place org hrefs are assembled. */
export function orgHref(orgId: string, path: string): string {
  return `/org/${orgId}/${path}`
}

/**
 * Does this pathname sit behind the rail?
 *
 * The org layout renders the master-detail shell only for rail destinations —
 * the four sidebar rows are full-width pages, like a studio's own. Matching on
 * the SEGMENT rather than the whole path keeps a detail route
 * (`/org/{id}/places/{placeId}`) inside its own rail, which is what the studio
 * settings do too.
 */
export const ORG_MANAGE_PATH = 'manage'

export function orgRailSegment(pathname: string): string | null {
  const m = pathname.match(/^\/org\/[^/]+\/([^/?#]+)/)
  const segment = m?.[1]
  if (!segment) return null
  if (segment === ORG_MANAGE_PATH) return segment
  return ORG_RAIL_ITEMS.some((i) => i.path === segment) ? segment : null
}

/** Is this the rail's own index — the org's answer to `/settings`? */
export function isOrgManageRoot(pathname: string): boolean {
  return orgRailSegment(pathname) === ORG_MANAGE_PATH
}

/** The catalogue entry for a pathname, wherever it lives. */
export function orgItemForPath(pathname: string): OrgNavItem | null {
  const segment = pathname.match(/^\/org\/[^/]+\/([^/?#]+)/)?.[1]
  if (!segment) return null
  return (
    ORG_NAV_ITEMS.find((i) => i.path === segment) ??
    ORG_RAIL_ITEMS.find((i) => i.path === segment) ??
    null
  )
}
