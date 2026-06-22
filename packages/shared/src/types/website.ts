import type { Timestamp } from './common'
import type { SocialLink } from './team'

// ─────────────────────────────────────────────────────────────────────────────
// Website plugin — studio site builder.
//
// A site is a single scrolling page made of stacked, typed sections. Two docs
// back it:
//   • site_drafts/{teamId}    — PRIVATE working copy (manager+ read/write)
//   • site_published/{teamId}  — PUBLIC, fully-public snapshot containing ONLY
//                                whitelisted fields. Written by the publishWebsite
//                                Cloud Function (clients can never write it).
//
// "Live" sections (pricing, schedule) store only presentation config here and
// read their data at render time from existing public mirrors (team
// public_profile.aggregator_subscription_types, session public_profile), so a
// published site stays fresh without re-publishing.
// ─────────────────────────────────────────────────────────────────────────────

export type SiteTheme = 'light' | 'dark' | 'auto'
export type SiteFont = 'sans' | 'serif' | 'rounded'
export type SectionAlign = 'left' | 'center'
export type SiteCtaAction = 'booking' | 'membership' | 'url'

/** A call-to-action button. `booking`/`membership` resolve to the team's bio-link
 *  flows; `url` opens an external link. */
export interface SiteCta {
  label: string
  action: SiteCtaAction
  url?: string
}

export interface SiteImage {
  url: string
  caption?: string
}

interface SectionBase {
  /** Stable id (used as React key, image upload path segment, anchor target). */
  id: string
  /** Whether this section shows as an item in the site's navigation menu.
   *  Defaults to visible (true) when unset; the hero is never listed. */
  showInNav?: boolean
  /** When true the section is kept in the draft but omitted from the published
   *  site (a quick show/hide that doesn't delete the section). */
  hidden?: boolean
}

export interface HeroSection extends SectionBase {
  type: 'hero'
  headline: string
  subheadline?: string
  bgImageUrl?: string
  /** Dark overlay strength over the background image, 0–100. */
  overlay?: number
  align: SectionAlign
  cta?: SiteCta
}

/** Generic free-form content block: a rich-text body (HTML, produced by the
 *  shared RichTextEditor) plus an optional title and optional side image. The
 *  legacy 'about' literal is still accepted so existing sites keep rendering;
 *  publish normalizes them to 'content'. */
export interface ContentSection extends SectionBase {
  type: 'content' | 'about'
  heading?: string
  body: string // rich text (HTML)
  imageUrl?: string
  imageSide: 'left' | 'right'
}

/** @deprecated Renamed to ContentSection (a generic content block). */
export type AboutSection = ContentSection

export interface GallerySection extends SectionBase {
  type: 'gallery'
  heading?: string
  images: SiteImage[]
  columns: 2 | 3 | 4
}

/** Pulls live activities from the team's public_profile mirrors (type: 'activity').
 *  Presented as a card grid; each card can deep-link into the booking flow. */
export interface ActivitiesSection extends SectionBase {
  type: 'activities'
  heading?: string
  subheading?: string
  source: 'activities'
  columns: 2 | 3 | 4
  /** Show a "Book" link on each card → /booking/[activitySlug]. */
  showBooking?: boolean
}

/** Pulls live data from the team's public_profile.aggregator_subscription_types. */
export interface PricingSection extends SectionBase {
  type: 'pricing'
  heading?: string
  subheading?: string
  source: 'subscriptions'
  ctaLabel?: string
}

/** Pulls upcoming bookable sessions from the session public_profile mirrors. */
export interface ScheduleSection extends SectionBase {
  type: 'schedule'
  heading?: string
  source: 'sessions'
  /** How many days ahead to show. Defaults to 7 when unset. */
  windowDays?: number
  /** Cap on how many sessions to list (keeps a busy schedule short). Unset/0 = no cap. */
  maxItems?: number
  /** Optional activity filter (activity id). */
  activityId?: string
}

export interface ContactSection extends SectionBase {
  type: 'contact'
  heading?: string
  address?: string
  phone?: string
  email?: string
  hours?: string
  /** Free-text place/address used to embed a map. */
  mapQuery?: string
  showSocial?: boolean
}

/** A studio-selected subset of the team's Places, rendered as simple cards (no map).
 *  Draft stores the selection (`placeIds`); publish embeds a whitelisted snapshot
 *  (`places`) so the public site needs no extra reads. */
export interface PlacesSection extends SectionBase {
  type: 'places'
  heading?: string
  subheading?: string
  columns: 2 | 3 | 4
  placeIds?: string[]
  places?: { id: string; name: string; address?: string; mapsLink?: string }[]
}

export type WebsiteSection =
  | HeroSection
  | ContentSection
  | GallerySection
  | ActivitiesSection
  | PricingSection
  | ScheduleSection
  | ContactSection
  | PlacesSection

export type WebsiteSectionType = WebsiteSection['type']

export interface SiteSeo {
  title?: string
  description?: string
  ogImageUrl?: string
}

export interface SiteHeader {
  /** Sticky top bar with in-page anchor nav. */
  showNav: boolean
  ctaLabel?: string
  ctaAction?: SiteCtaAction
  ctaUrl?: string
}

export interface SiteFooter {
  showSocial: boolean
}

export interface SiteMeta {
  title: string
  theme: SiteTheme
  accentColor: string
  font: SiteFont
  seo?: SiteSeo
  header: SiteHeader
  footer: SiteFooter
}

/** PRIVATE working copy — site_drafts/{teamId}. Manager+ read/write. */
export interface SiteDraft {
  teamId: string
  slug: string
  name: string
  /** When false the published site is removed and /site/[slug] 404s. */
  enabled: boolean
  meta: SiteMeta
  sections: WebsiteSection[]
  updated_at?: Timestamp
  updatedBy?: string
}

/** PUBLIC snapshot — site_published/{teamId}. Public read, function-write only.
 *  Contains ONLY whitelisted public fields. */
export interface PublishedSite {
  teamId: string
  slug: string
  name: string
  meta: SiteMeta
  sections: WebsiteSection[]
  /** Denormalised from the team at publish time, for footer/contact icons. */
  socialLinks?: SocialLink[]
  /** Denormalised from the plan — true on the free plan ("Powered by Linyup"). */
  showBranding?: boolean
  published_at?: Timestamp
  updated_at?: Timestamp
}
