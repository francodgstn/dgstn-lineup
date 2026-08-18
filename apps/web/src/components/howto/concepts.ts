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

// Order matters: the selector cards render in this order, and it deliberately
// mirrors the map — Contacts (apex) first, then the base read left to right.
export const CONCEPTS: Concept[] = [
  { id: 'contacts', icon: Users, links: [{ href: '/contacts', labelKey: 'open' }] },
  {
    id: 'subscriptions',
    icon: IdCard,
    links: [
      { href: '/offer/plans', labelKey: 'plans' },
      { href: '/offer/affiliations', labelKey: 'affiliations' },
    ],
  },
  { id: 'activities', icon: Zap, links: [{ href: '/offer/activities', labelKey: 'manage' }] },
  {
    id: 'sessions',
    icon: CalendarDays,
    links: [{ href: '/schedule', labelKey: 'schedule' }],
  },
]

// ─── concept-map geometry (triangle) ──────────────────────────────────────────
// viewBox 0 0 560 258. Contacts at the apex; its base holds Subscriptions
// (left) → Activities (middle) → Sessions (right). The base gaps are wide
// (68px / 88px) so the connectors read as connectors and their labels have room.
export const MAP_VIEWBOX = '0 0 560 258'

export interface MapNode {
  id: ConceptId
  x: number
  y: number
  w: number
  h: number
}

export const MAP_NODES: MapNode[] = [
  { id: 'contacts', x: 215, y: 12, w: 130, h: 44 },
  { id: 'subscriptions', x: 10, y: 200, w: 140, h: 44 },
  { id: 'activities', x: 220, y: 200, w: 120, h: 44 },
  { id: 'sessions', x: 430, y: 200, w: 120, h: 44 },
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
//
// The two base labels sit clear of their line, just above the boxes' top edge
// (y 200): a translated label is usually wider than the gap it names, so on the
// line it would be run over by the boxes on either side.
export const MAP_EDGES: MapEdge[] = [
  { labelKey: 'hold', x1: 245, y1: 56, x2: 80, y2: 200, lx: 155, ly: 124 },
  { labelKey: 'book', x1: 315, y1: 56, x2: 490, y2: 200, lx: 410, ly: 124 },
  { labelKey: 'unlocks', x1: 150, y1: 222, x2: 218, y2: 222, lx: 184, ly: 192 },
  { labelKey: 'scheduledAs', x1: 340, y1: 222, x2: 428, y2: 222, lx: 384, ly: 192 },
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

// A TEACHING SUBSET, not the census. The authoritative list of public surfaces —
// and of where each one is managed — is the `surfaces` array in
// (auth)/public-page/(hub)/page.tsx; this list exists to explain the idea, so it
// carries only the surfaces that have a wireframe and a paragraph written for
// them in the `HowTo.publicPages.surfaces` copy. It therefore differs from the
// census in both directions (it has appointments, which the hub does not; the hub
// has signup, forms and documents, which this does not) and that is fine as long
// as nobody reads it as complete — which is what the "see all" link the section
// renders is for. Adding a surface HERE without copy + a preview renders an empty
// panel; adding one to the hub is the change that matters.
export const PUBLIC_PAGES: PublicPage[] = [
  { id: 'bioLink', icon: LinkIcon, href: '/team/bio-link' },
  { id: 'website', icon: Globe, href: '/plugins/website' },
  { id: 'booking', icon: CalendarCheck, href: '/settings/booking' },
  { id: 'shop', icon: ShoppingBag, href: '/public-page/shop' },
  { id: 'space', icon: DoorOpen, href: '/public-page/space' },
  { id: 'appointments', icon: UserRound, href: '/schedule' },
  { id: 'kiosk', icon: Monitor, href: '/plugins/kiosk' },
]
