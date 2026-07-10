// Rolling "tips & tricks" shown in the dashboard DiscoverPanel. Title/body text
// lives in the `Discover` i18n namespace under tip_{id}_title / tip_{id}_body.
export interface DiscoverTip {
  id: string
  icon: string // lucide icon name (resolved via DynamicIcon)
  href?: string // optional deep link to the relevant feature
}

export const TIPS: DiscoverTip[] = [
  { id: 'bioLink', icon: 'Share2', href: '/team/bio-link' },
  { id: 'automations', icon: 'Workflow', href: '/automations' },
  { id: 'contacts', icon: 'Users', href: '/contacts' },
  { id: 'website', icon: 'Globe', href: '/plugins/website' },
  { id: 'recurring', icon: 'CalendarClock', href: '/schedule' },
  // No href — the tip is about the sidebar itself (pin from any menu row).
  { id: 'pinNav', icon: 'Pin' },
]
