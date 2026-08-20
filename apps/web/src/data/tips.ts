// Rolling "tips & tricks". Title/body text lives in the `Discover` i18n
// namespace under tip_{id}_title / tip_{id}_body.
//
// The dashboard's DiscoverPanel was their original home and is gone — the new
// dashboard dropped Discover by decision (a shelf you go to, not a thing you are
// handed while finding out whether the 09:00 is full). The remaining reader is
// components/howto/HowToUtilities.tsx, which is that shelf.
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
  // Waitlists are off by default and their per-activity toggle is hidden until
  // the studio switches them on, so this tip is the main way anyone finds out
  // the feature exists. It deep-links to the switch that reveals it.
  { id: 'waitlist', icon: 'ListOrdered', href: '/settings/booking' },
]
