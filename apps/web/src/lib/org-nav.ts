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
  Compass,
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
import type { OrgRole } from '@linyup/shared'

/** Where an org destination lives: a sidebar row, or the rail's one group. */
export type OrgRailGroupKey = 'general'

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
 * The test for membership is "would a federation administrator open this during
 * a working day". Programme templates sits beside Events because it is read
 * while creating one; Website is authoring, exactly as a studio's Website is a
 * sidebar row rather than a setting.
 *
 * ── AFFILIATIONS AND PLACES WERE BEHIND THE RAIL, AND THAT WAS WRONG ────────
 * Both are working destinations that a rail full of configuration was hiding
 * (Franco, 2026-08-28). Affiliations is a ROSTER — the people the organisation
 * has issued a licence, badge or membership to — which is daily work, not a
 * setting; it now carries the vocabulary editors too, so the thing and the
 * words for it are in one place instead of two. Places is a shared resource a
 * studio books against, and it already rendered a full page with its own
 * search and detail routes; it earns a row rather than a slot in a rail.
 *
 * What is left behind the rail is genuinely configurational, which is why it
 * collapsed from three groups to one.
 */
export const ORG_NAV_ITEMS: OrgNavItem[] = [
  { id: 'org-teams', path: 'teams', labelKey: 'navStudios', icon: Building2 },
  { id: 'org-events', path: 'events', labelKey: 'tabEvents', icon: CalendarRange },
  {
    id: 'org-program-templates',
    path: 'program-templates',
    labelKey: 'tabProgramTemplates',
    icon: ListTodo,
  },
  {
    id: 'org-affiliations',
    path: 'affiliations',
    labelKey: 'tabAffiliations',
    icon: IdCard,
    dynamicLabel: 'affiliationTerm',
  },
  { id: 'org-places', path: 'places', labelKey: 'tabPlaces', icon: MapPin },
  { id: 'org-website', path: 'website', labelKey: 'tabWebsite', icon: Globe },
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
  { id: 'org-manage', path: 'manage', labelKey: 'manageTitle', icon: Settings2 },
]

/**
 * THE ROWS A **MEMBER STUDIO** SEES — the other audience in org scope.
 *
 * Two different people open an organisation and only one of them runs it:
 *
 *   an ORG MEMBER   — has an `org_members` row. Gets ORG_NAV_ITEMS above.
 *   a MEMBER STUDIO — their STUDIO is in `org_teams`; they have no row of their
 *                     own. Gets this list.
 *
 * The second used to get the first list, and it did not survive contact with
 * the security rules: `org_teams` is readable by `isOrgMember(orgId) ||
 * isTeamMember(teamId)`, so listing the roster returns a sibling studio's row
 * that fails both arms and Firestore denies the WHOLE query. A studio owner
 * therefore opened Studios and read "No teams have joined this organization
 * yet" about the federation they are a member of (Franco, 2026-08-27).
 *
 * The fix is not to widen the rule. A federation's roster, its billing, its
 * members and its website are the organisers' business, and the honest answer
 * to "what is an organisation to a studio that belongs to one" is a different
 * question with a different answer:
 *
 *   Overview           — what this organisation is, what your studio's standing
 *                        in it is, and what it hands down to you. The one new
 *                        page; everything on it was already readable.
 *   Events             — the federation's own calendar. `events` admits
 *                        `currentTeamInOrg`, and the page already gates its
 *                        authoring on `isAdmin`.
 *   Programme templates — the camp programmes the org authors and a studio
 *                        applies. Same story: readable, and the manager already
 *                        takes `canEdit={isAdmin}`.
 *
 * The two shared rows are here because they ALREADY worked read-only for this
 * audience — nothing was relaxed to include them. Studios, Website and the
 * management rail are absent because they do not.
 *
 * Franco's framing (2026-08-28), and the reason this is a list rather than a
 * refusal: a studio in a federation should be able to reach it "as a high level
 * summary… or other generic org wide stuff". This is the first entry in that
 * list; a way to get in touch, and an org feed, are named as later work.
 */
export const ORG_STUDIO_NAV_ITEMS: OrgNavItem[] = [
  { id: 'org-overview', path: 'overview', labelKey: 'navOverview', icon: Compass },
  { id: 'org-events', path: 'events', labelKey: 'tabEvents', icon: CalendarRange },
  {
    id: 'org-program-templates',
    path: 'program-templates',
    labelKey: 'tabProgramTemplates',
    icon: ListTodo,
  },
]

/**
 * Which row list this person gets. `null` role = a member studio.
 *
 * The org-member list is the default for anyone who HAS a seat, viewer
 * included: an `org_viewer` satisfies `isOrgMember` in the rules, so every row
 * in it loads for them, and the pages that can be edited already gate their own
 * controls on `isAdmin`.
 */
export function orgNavItemsForRole(role: OrgRole | null): OrgNavItem[] {
  return role == null ? ORG_STUDIO_NAV_ITEMS : ORG_NAV_ITEMS
}

/**
 * Where `/org/{orgId}` lands. An organiser opens the roster; a member studio
 * opens the summary — the roster is the one page their own membership does not
 * let them read.
 */
export function orgLandingPath(role: OrgRole | null): string {
  return role == null ? 'overview' : 'teams'
}

/**
 * THE RAIL — everything configurational, in ONE group.
 *
 * It used to carry three: what the organisation IMPOSES on its studios, what it
 * LENDS them, and what is about the organisation itself. That grouping was true
 * of the data and still wrong for the reader, because two of the three groups
 * held one row each once Affiliations and Places moved to the sidebar — and a
 * heading over a single row is a label pretending to be a category.
 *
 * So the remainder is one list (Franco, 2026-08-28). Ranking stays because it
 * is a scale you set once and revisit rarely; the other four are the
 * organisation's own administration.
 */
export const ORG_RAIL_ITEMS: (OrgNavItem & { group: OrgRailGroupKey })[] = [
  { id: 'org-ranking', path: 'ranking', labelKey: 'tabRanking', icon: Shield, group: 'general' },
  { id: 'org-members', path: 'members', labelKey: 'tabMembers', icon: Users, group: 'general', adminOnly: true },
  { id: 'org-plugins', path: 'plugins', labelKey: 'tabPlugins', icon: Blocks, group: 'general', adminOnly: true },
  { id: 'org-billing', path: 'billing', labelKey: 'tabBilling', icon: CreditCard, group: 'general', adminOnly: true },
  { id: 'org-settings', path: 'settings', labelKey: 'tabSettings', icon: Settings, group: 'general', adminOnly: true },
]

/** Group order in the rail, with the `Org` i18n key for each heading. */
export const ORG_RAIL_GROUPS: { key: OrgRailGroupKey; labelKey: string }[] = [
  { key: 'general', labelKey: 'railGroupGeneral' },
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
