import type { Timestamp } from './common'
import type { PublicSurface, SocialLink } from './team'

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
export type SiteCtaAction = 'booking' | 'signup' | 'url'

/** A call-to-action button. `booking`/`signup` resolve to the team's bio-link
 *  flows; `url` opens an external link. ('membership' is a legacy alias for
 *  'signup', still accepted on read/publish for older stored sites.) */
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
  /** Short label shown for this section in the nav menu. When unset, the nav
   *  falls back to the section's heading (or a type default). Lets a studio keep
   *  a long on-page title while the menu stays terse (e.g. heading "Our weekly
   *  schedule" → menu "Schedule"). */
  menuLabel?: string
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
  /**
   * Card arrangement:
   *  - 'grid' (default): image on top, content below, `columns` per row
   *  - 'list': one full-width row per activity, image left / content right
   *
   * Absent ⇒ 'grid', so existing sites are unaffected. `columns` is ignored in
   * list layout (a list is always one per row) but kept, so switching back to
   * grid restores the studio's column choice.
   */
  layout?: 'grid' | 'list'
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
  /** Studio's default view. The live site also shows a small List/Calendar toggle.
   *  'calendar' = weekly time-grid planner (formerly 'week', a chip grid).
   *  Defaults to 'calendar' when unset. */
  displayMode?: 'list' | 'calendar'
  /** Show a small "Book" icon on each session row/chip → /booking. Off by default
   *  (the space is tight and it repeats on every session). */
  showBooking?: boolean
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

/**
 * A studio's OVERRIDE for one auto-derived cross-surface header link.
 *
 * The link list itself comes from `TeamPublicProfile.active_public_surfaces` at
 * render time, not from here — so enabling the shop plugin surfaces a Shop link
 * without the studio having to re-edit the website. This type only records the
 * studio's deviations from that default.
 *
 * `surface` is the stable machine identifier (see PublicSurface); an entry
 * naming a surface that isn't live is ignored rather than removed, so toggling a
 * plugin off and on again doesn't lose the label the studio wrote.
 */
export interface SiteSurfaceLinkConfig {
  surface: PublicSurface
  /** Hide a link the studio doesn't want in the nav. Absent ⇒ visible. */
  hidden?: boolean
  /** Replaces the default localized name (the `PublicSurfaceLinks` messages). */
  label?: string
  /** Ascending. Unset entries sort after the configured ones, in their natural order. */
  order?: number
}

export interface SiteHeader {
  /** Sticky top bar with in-page anchor nav. */
  showNav: boolean
  ctaLabel?: string
  ctaAction?: SiteCtaAction
  ctaUrl?: string
  /**
   * Show the member control ("Sign in" / "My space") in the header. Absent ⇒
   * shown: a returning member on the website otherwise has no way into their
   * Space, which is the gap this exists to close.
   */
  showSignIn?: boolean
  /** Per-surface overrides for the auto-derived links. See SiteSurfaceLinkConfig. */
  surfaceLinks?: SiteSurfaceLinkConfig[]
}

/**
 * Which cross-surface links a website header shows, and in what order.
 *
 * The list is DERIVED from what's live and then adjusted by the studio's
 * overrides — never stored wholesale. That ordering matters: a studio that
 * enables the online-courses plugin should get a Shop link without editing the
 * site, and a studio that disabled the shop shouldn't get a dead link back when
 * they re-enable it.
 *
 * `defaultLabel` is injected by the caller (it's localized in the web app), so
 * this stays framework- and locale-agnostic and can be unit-tested.
 */
export function resolveSiteSurfaceLinks(
  header: SiteHeader | undefined,
  liveSurfaces: readonly PublicSurface[],
  defaultLabel: (surface: PublicSurface) => string
): { surface: PublicSurface; label: string }[] {
  const overrides = new Map(
    (header?.surfaceLinks ?? []).map((c) => [c.surface, c] as const)
  )
  return liveSurfaces
    .filter((s) => !overrides.get(s)?.hidden)
    .map((surface, index) => {
      const config = overrides.get(surface)
      return {
        surface,
        label: config?.label?.trim() || defaultLabel(surface),
        // Unconfigured links keep their natural order, after the configured ones.
        order: config?.order ?? Number.MAX_SAFE_INTEGER,
        index,
      }
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ surface, label }) => ({ surface, label }))
}

export interface SiteFooter {
  showSocial: boolean
}

export interface SiteMeta {
  title: string
  theme: SiteTheme
  accentColor: string
  font: SiteFont
  // Optional custom page background (a hex color or full CSS value, e.g. a
  // linear-gradient). Overrides the theme's default page background; the header
  // keeps a theme-based translucent bar. Text stays theme-driven, so pick a
  // background that suits the chosen `theme` (a light one for theme: 'light').
  background?: string
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

// ─────────────────────────────────────────────────────────────────────────────
// Standalone embed widgets
//
// A studio that already has its own website can embed individual Linyup sections
// (schedule, pricing, …) WITHOUT building or publishing a Linyup site. Each widget
// is just a WebsiteSection authored on its own, with its own look. Stored PUBLICLY
// at embed_widgets/{teamId} (public read, manager write — the config IS the public
// config, so there is no draft/publish split like the full site). The /embed route
// resolves a widget by id first, then falls back to a published site section.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-widget look. Standalone widgets have no SiteMeta, so each carries its own. */
export interface WidgetTheme {
  theme: SiteTheme
  accentColor?: string
  font?: SiteFont
  /** 'transparent' lets the host page's background show through (blends in). */
  background: 'solid' | 'transparent'
}

/** One standalone, embeddable widget: a section plus a studio-facing label and look. */
export type EmbedWidget = WebsiteSection & {
  /** Studio-facing name shown in the builder list (the section type is the fallback). */
  label?: string
  theme?: WidgetTheme
}

/** PUBLIC per-team set of standalone widgets — embed_widgets/{teamId}.
 *  Public read, manager write. */
export interface EmbedWidgetSet {
  teamId: string
  slug: string
  widgets: EmbedWidget[]
  /** Denormalised from the team so contact widgets can render social icons. */
  socialLinks?: SocialLink[]
  updated_at?: Timestamp
  updatedBy?: string
}
