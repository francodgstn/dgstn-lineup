import type { WebsiteSection, WebsiteSectionType, SiteDraft, SiteMeta } from '@linyup/shared'

// ─── section library (for the "Add section" menu) ──────────────────────────────
// icon names map to lucide icons resolved in the builder via the shared DynamicIcon.

export const SECTION_LIBRARY: {
  type: WebsiteSectionType
  labelKey: string
  descKey: string
  icon: string
}[] = [
  { type: 'hero', labelKey: 'sectionHero', descKey: 'sectionHeroDesc', icon: 'Image' },
  { type: 'about', labelKey: 'sectionAbout', descKey: 'sectionAboutDesc', icon: 'FileText' },
  { type: 'gallery', labelKey: 'sectionGallery', descKey: 'sectionGalleryDesc', icon: 'Images' },
  {
    type: 'activities',
    labelKey: 'sectionActivities',
    descKey: 'sectionActivitiesDesc',
    icon: 'LayoutGrid',
  },
  { type: 'pricing', labelKey: 'sectionPricing', descKey: 'sectionPricingDesc', icon: 'Tag' },
  {
    type: 'schedule',
    labelKey: 'sectionSchedule',
    descKey: 'sectionScheduleDesc',
    icon: 'CalendarDays',
  },
  { type: 'contact', labelKey: 'sectionContact', descKey: 'sectionContactDesc', icon: 'MapPin' },
]

/** Client-only unique id for a new section (React key + image path segment + anchor). */
export function newSectionId(): string {
  return `s-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6)}`
}

export function newSection(type: WebsiteSectionType): WebsiteSection {
  const id = newSectionId()
  switch (type) {
    case 'hero':
      return { id, type, headline: 'Welcome', align: 'center', overlay: 40 }
    case 'about':
      return { id, type, heading: 'About us', body: '', imageSide: 'left' }
    case 'gallery':
      return { id, type, images: [], columns: 3 }
    case 'activities':
      return { id, type, source: 'activities', columns: 3, showBooking: true }
    case 'pricing':
      return { id, type, source: 'subscriptions' }
    case 'schedule':
      return { id, type, source: 'sessions', windowDays: 7 }
    case 'contact':
      return { id, type, showSocial: true }
  }
}

/** Fresh draft for a team that has never opened the builder. */
export function emptyDraft(team: {
  id: string
  name: string
  slug?: string
  bioLinkAccentColor?: string
}): SiteDraft {
  const meta: SiteMeta = {
    title: team.name,
    theme: 'light',
    accentColor: team.bioLinkAccentColor || '#6366f1',
    font: 'sans',
    header: { showNav: true, ctaLabel: 'Book now', ctaAction: 'booking' },
    footer: { showSocial: true },
  }
  return {
    teamId: team.id,
    slug: team.slug || '',
    name: team.name,
    enabled: false,
    meta,
    sections: [newSection('hero'), newSection('about'), newSection('contact')],
  }
}
