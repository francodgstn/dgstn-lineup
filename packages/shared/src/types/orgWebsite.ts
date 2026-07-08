import type { Timestamp } from './common'
import type { SocialLink } from './team'
import type {
  SiteMeta,
  HeroSection,
  ContentSection,
  GallerySection,
  ContactSection,
} from './website'

// ─────────────────────────────────────────────────────────────────────────────
// Organization website — the org-level public site.
//
// Mirrors the team website builder (./website.ts) but keyed by orgId, with
// org-specific AGGREGATE sections (clubs / locations / coaches) instead of the
// team-commerce ones (pricing / activities / schedule / shop don't apply at org
// level). Two docs back it, exactly like the team site:
//   • org_site_drafts/{orgId}     — PRIVATE working copy (org_admin read/write)
//   • org_site_published/{orgId}  — PUBLIC snapshot, written ONLY by the
//                                   publishOrgWebsite Cloud Function.
//
// The aggregate sections store only presentation config. The published doc embeds
// a snapshot of member teams (resolved from org_teams at publish); the live blocks
// read each team's world-readable public_profile at render time, so per-club
// branding / location / coaches stay fresh WITHOUT re-publishing. Only the member
// list itself is a snapshot (changes to org membership need a republish).
// ─────────────────────────────────────────────────────────────────────────────

/** A member team embedded in the published org site (resolved from org_teams). */
export interface OrgSiteTeamRef {
  teamId: string
  slug: string
  name: string
}

/** Shared base for org-only sections (same shape as the team site's SectionBase,
 *  which isn't exported). */
interface OrgSectionBase {
  id: string
  showInNav?: boolean
  hidden?: boolean
}

/** Clubs directory — a card per member team, linking to its public bio-link,
 *  enriched live from each team's public_profile (logo / hero / primary address). */
export interface ClubsSection extends OrgSectionBase {
  type: 'clubs'
  heading?: string
  subheading?: string
  columns: 2 | 3 | 4
  /** Show each club's primary address on its card. */
  showAddress?: boolean
}

/** Locations — every club's primary address aggregated (live), plus optional
 *  org-authored extra venues typed directly in the section. */
export interface LocationsSection extends OrgSectionBase {
  type: 'locations'
  heading?: string
  subheading?: string
  columns: 2 | 3 | 4
  extra?: { id: string; name: string; address?: string; mapsLink?: string }[]
}

/** Coaches — roster aggregated across the member teams that opted in
 *  (team.public_coaches_enabled → team public_profile.coaches). */
export interface CoachesSection extends OrgSectionBase {
  type: 'coaches'
  heading?: string
  subheading?: string
  columns: 2 | 3 | 4
}

/** The org site section union: reused presentational sections + org aggregates.
 *  NO pricing / activities / schedule / places (team-scoped commerce). */
export type OrgSiteSection =
  | HeroSection
  | ContentSection
  | GallerySection
  | ContactSection
  | ClubsSection
  | LocationsSection
  | CoachesSection

export type OrgSiteSectionType = OrgSiteSection['type']

/** PRIVATE working copy — org_site_drafts/{orgId}. Org admin read/write. */
export interface OrgSiteDraft {
  orgId: string
  slug: string
  name: string
  /** When false the published site is removed and /public/org/{slug} 404s. */
  enabled: boolean
  meta: SiteMeta
  sections: OrgSiteSection[]
  updated_at?: Timestamp
  updatedBy?: string
}

/** PUBLIC snapshot — org_site_published/{orgId}. Public read, function-write only.
 *  Contains ONLY whitelisted public fields. */
export interface OrgPublishedSite {
  orgId: string
  slug: string
  name: string
  meta: SiteMeta
  sections: OrgSiteSection[]
  /** Snapshot of member teams (from org_teams at publish). Live blocks read each
   *  team's public_profile by teamId for fresh branding / location / coaches. */
  teams: OrgSiteTeamRef[]
  /** Denormalised org social links for footer/contact icons. */
  socialLinks?: SocialLink[]
  /** Denormalised from the plan — true on the free plan ("Powered by Linyup"). */
  showBranding?: boolean
  published_at?: Timestamp
  updated_at?: Timestamp
}
