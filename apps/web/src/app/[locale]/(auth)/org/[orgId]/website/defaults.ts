import type { OrgSiteSection, OrgSiteSectionType, OrgSiteDraft, SiteMeta } from '@linyup/shared'
// Client-only unique id generator — shared verbatim with the team site builder
// (React key + image path segment + anchor). Not org/team-specific.
import { newSectionId } from '@/plugins/website/defaults'

// ─── section library (for the "Add section" menu) ──────────────────────────────
// Org sites only ever offer presentational sections (hero/content/gallery/contact,
// shared with the team site) plus the three org-only aggregate sections
// (clubs/locations/coaches). NO pricing/activities/schedule/places — those are
// team-scoped commerce sections that don't apply at the org level.

export const ORG_SECTION_LIBRARY: {
  type: OrgSiteSectionType
  labelKey: string
  descKey: string
  icon: string
}[] = [
  { type: 'hero', labelKey: 'sectionHero', descKey: 'sectionHeroDesc', icon: 'Image' },
  { type: 'content', labelKey: 'sectionContent', descKey: 'sectionContentDesc', icon: 'FileText' },
  { type: 'gallery', labelKey: 'sectionGallery', descKey: 'sectionGalleryDesc', icon: 'Images' },
  { type: 'clubs', labelKey: 'sectionClubs', descKey: 'sectionClubsDesc', icon: 'Building2' },
  {
    type: 'locations',
    labelKey: 'sectionLocations',
    descKey: 'sectionLocationsDesc',
    icon: 'MapPin',
  },
  { type: 'coaches', labelKey: 'sectionCoaches', descKey: 'sectionCoachesDesc', icon: 'UserCog' },
  { type: 'contact', labelKey: 'sectionContact', descKey: 'sectionContactDesc', icon: 'Mail' },
]

export function newOrgSection(type: OrgSiteSectionType): OrgSiteSection {
  const id = newSectionId()
  switch (type) {
    case 'hero':
      return { id, type, headline: 'Welcome', align: 'center', overlay: 40 }
    // 'about' isn't offered from the section library, but is part of
    // OrgSiteSectionType (inherited from ContentSection's legacy alias) — handled
    // here purely for switch exhaustiveness, normalized to 'content'.
    case 'content':
    case 'about':
      return { id, type: 'content', body: '', imageSide: 'left' }
    case 'gallery':
      return { id, type, images: [], columns: 3 }
    case 'clubs':
      return { id, type, columns: 3, showAddress: true }
    case 'locations':
      return { id, type, columns: 3 }
    case 'coaches':
      return { id, type, columns: 3 }
    case 'contact':
      return { id, type, showSocial: true }
  }
}

/** Fresh draft for an org that has never opened the builder. */
export function emptyOrgDraft(org: { id: string; name: string; slug?: string }): OrgSiteDraft {
  const meta: SiteMeta = {
    title: org.name,
    theme: 'light',
    accentColor: '#6366f1',
    font: 'sans',
    header: { showNav: true },
    footer: { showSocial: true },
  }
  return {
    orgId: org.id,
    slug: org.slug || '',
    name: org.name,
    enabled: false,
    meta,
    sections: [
      newOrgSection('hero'),
      newOrgSection('content'),
      newOrgSection('clubs'),
      newOrgSection('contact'),
    ],
  }
}
