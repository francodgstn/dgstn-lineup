import type { OrgSiteSection, OrgSiteSectionType, OrgSiteDraft, SiteMeta } from '@linyup/shared'
// Client-only unique id generator — shared verbatim with the team site builder
// (React key + image path segment + anchor). Not org/team-specific.
import { newSectionId } from '@/plugins/website/defaults'
import { DEFAULT_ACCENT } from '@/components/ui/color-picker'

// ─── section library (for the "Add section" menu) ──────────────────────────────
// Org sites offer the PRESENTATIONAL sections — hero, content, gallery, features,
// CTA banner, FAQ, testimonials, contact, all shared with the team site — plus
// the three org-only aggregates (clubs / locations / coaches).
//
// NO pricing / activities / schedule / places: those are team-scoped commerce and
// an organisation has nothing to put in them. That was always the rule, but four
// presentational sections were missing anyway — they were added to the team
// library after this file was written and nobody pulled them across, so a
// federation could not put an FAQ on its own site (Franco, 2026-09-05).

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
  { type: 'features', labelKey: 'sectionFeatures', descKey: 'sectionFeaturesDesc', icon: 'Sparkles' },
  { type: 'cta_banner', labelKey: 'sectionCta', descKey: 'sectionCtaDesc', icon: 'Megaphone' },
  { type: 'faq', labelKey: 'sectionFaq', descKey: 'sectionFaqDesc', icon: 'HelpCircle' },
  {
    type: 'testimonials',
    labelKey: 'sectionTestimonials',
    descKey: 'sectionTestimonialsDesc',
    icon: 'Quote',
  },
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
    case 'features':
      return {
        id,
        type,
        columns: 3,
        items: [
          { icon: 'Sparkles', title: 'Feature', text: 'A short line about it.' },
          { icon: 'Sparkles', title: 'Feature', text: 'A short line about it.' },
          { icon: 'Sparkles', title: 'Feature', text: 'A short line about it.' },
        ],
      }
    case 'cta_banner':
      return { id, type, heading: 'Find a club near you', text: 'Our studios are open to new members.' }
    case 'faq':
      return { id, type, items: [{ question: 'A question?', answer: 'The answer.' }] }
    case 'testimonials':
      return {
        id,
        type,
        items: [{ name: 'Alex', activity: 'Member', feedback: 'Best decision I made.' }],
      }
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
    accentColor: DEFAULT_ACCENT,
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
