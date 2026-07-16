// Data (no copy) for the How-to page. Two independent groups:
//  • CONCEPTS — the four connected core concepts, drawn as a triangle in the
//    Core concepts area (ConceptMap + selector cards).
//  • PUBLIC_PAGES — the world-facing surfaces, shown as vertical tabs in their
//    own section below. Public pages was pulled out of the concept flow: it's an
//    output of the model (how the world reaches it), not a peer entity.
// All visible text lives in the `HowTo` i18n namespace.
import type { LucideIcon } from 'lucide-react'
import {
  Zap,
  CalendarDays,
  IdCard,
  Users,
  Link as LinkIcon,
  Globe,
  CalendarCheck,
  ShoppingBag,
  DoorOpen,
  UserRound,
  Monitor,
} from 'lucide-react'

// ─── core concepts (the triangle) ─────────────────────────────────────────────

export type ConceptId = 'activities' | 'sessions' | 'subscriptions' | 'contacts'

export interface Concept {
  id: ConceptId
  /** Icons mirror the sidebar so the concepts map onto the nav. */
  icon: LucideIcon
  /** "See it in the app" links; labelKey under HowTo.concepts.{id}.links. */
  links: { href: string; labelKey: string }[]
}

export const CONCEPTS: Concept[] = [
  { id: 'activities', icon: Zap, links: [{ href: '/offer/activities', labelKey: 'manage' }] },
  {
    id: 'sessions',
    icon: CalendarDays,
    links: [{ href: '/schedule', labelKey: 'schedule' }],
  },
  {
    id: 'subscriptions',
    icon: IdCard,
    links: [
      { href: '/offer/plans', labelKey: 'plans' },
      { href: '/offer/affiliations', labelKey: 'affiliations' },
    ],
  },
  { id: 'contacts', icon: Users, links: [{ href: '/contacts', labelKey: 'open' }] },
]

// ─── concept-map geometry (triangle) ──────────────────────────────────────────
// viewBox 0 0 500 270. Contacts at the apex; its base holds Subscriptions
// (left) → Activities (middle) → Sessions (right).
export const MAP_VIEWBOX = '0 0 500 270'

export interface MapNode {
  id: ConceptId
  x: number
  y: number
  w: number
  h: number
}

export const MAP_NODES: MapNode[] = [
  { id: 'contacts', x: 190, y: 12, w: 130, h: 44 },
  { id: 'subscriptions', x: 12, y: 190, w: 140, h: 44 },
  { id: 'activities', x: 195, y: 190, w: 120, h: 44 },
  { id: 'sessions', x: 368, y: 190, w: 120, h: 44 },
]

export interface MapEdge {
  /** Label key under HowTo.edges. */
  labelKey: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** Label anchor point (roughly mid-edge, nudged off the line). */
  lx: number
  ly: number
}

// Triangle edges: Contacts "hold" Subscriptions + "book" Sessions (the two
// sloping sides); Subscriptions "unlock" Activities and Activities are
// "scheduled as" Sessions (along the base).
export const MAP_EDGES: MapEdge[] = [
  { labelKey: 'hold', x1: 218, y1: 56, x2: 110, y2: 190, lx: 152, ly: 120 },
  { labelKey: 'book', x1: 292, y1: 56, x2: 398, y2: 190, lx: 358, ly: 120 },
  { labelKey: 'unlocks', x1: 152, y1: 212, x2: 193, y2: 212, lx: 172, ly: 204 },
  { labelKey: 'scheduledAs', x1: 315, y1: 212, x2: 366, y2: 212, lx: 340, ly: 204 },
]

// ─── public pages (their own section) ─────────────────────────────────────────

export type PublicPageId =
  | 'bioLink'
  | 'website'
  | 'booking'
  | 'shop'
  | 'space'
  | 'appointments'
  | 'kiosk'

export interface PublicPage {
  id: PublicPageId
  icon: LucideIcon
  /** Where the surface is managed/viewed in the admin. */
  href: string
}

export const PUBLIC_PAGES: PublicPage[] = [
  { id: 'bioLink', icon: LinkIcon, href: '/team/bio-link' },
  { id: 'website', icon: Globe, href: '/plugins/website' },
  { id: 'booking', icon: CalendarCheck, href: '/settings/booking' },
  { id: 'shop', icon: ShoppingBag, href: '/public-page/shop' },
  { id: 'space', icon: DoorOpen, href: '/public-page/space' },
  { id: 'appointments', icon: UserRound, href: '/schedule' },
  { id: 'kiosk', icon: Monitor, href: '/plugins/kiosk' },
]
