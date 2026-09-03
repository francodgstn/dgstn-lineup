// Data (no copy) for the Pricing section of the How-to page — mirrors
// components/howto/concepts.ts's split of geometry/wiring from copy. Two
// independent pieces:
//  • MONEY_MAP_NODES/EDGES — the four-node diagram in PricingMoneyMap (What
//    you offer / What you sell / Member benefits / The price preview).
//  • PRICING_RECIPES — the ids + "Set it up" deep links driving the goal-chip
//    cookbook in PricingRecipes.
// Both share HowTo.pricing.linkLabels for their in-app links, so a route
// rename only needs updating in one i18n place. All visible text lives in the
// `HowTo.pricing` i18n namespace.
import type { LucideIcon } from 'lucide-react'
import { Package, Tag, Sparkles, Eye } from 'lucide-react'

// ─── money map (four nodes) ────────────────────────────────────────────────

export type MoneyMapNodeId = 'offer' | 'sell' | 'benefits' | 'preview'

export interface MoneyMapNode {
  id: MoneyMapNodeId
  icon: LucideIcon
  x: number
  y: number
  w: number
  h: number
  /** "See it in the app" link. labelKey is under HowTo.pricing.linkLabels. */
  href: string
  linkKey: string
}

// viewBox 0 0 560 290. "What you offer" and "What you sell" sit as wings up
// top; both flow into "Member benefits" in the middle, which flows down into
// "The price preview" — the same column as benefits, so the funnel reads
// top-to-bottom on narrow screens too.
export const MONEY_MAP_VIEWBOX = '0 0 560 290'

export const MONEY_MAP_NODES: MoneyMapNode[] = [
  { id: 'offer', icon: Package, x: 15, y: 14, w: 170, h: 48, href: '/offer/activities', linkKey: 'activities' },
  { id: 'sell', icon: Tag, x: 375, y: 14, w: 170, h: 48, href: '/offer/plans', linkKey: 'plans' },
  { id: 'benefits', icon: Sparkles, x: 195, y: 118, w: 170, h: 48, href: '/offer/activities', linkKey: 'activities' },
  { id: 'preview', icon: Eye, x: 195, y: 222, w: 170, h: 48, href: '/manage/pricing', linkKey: 'pricing' },
]

export interface MoneyMapEdge {
  /** Label key under HowTo.pricing.map.edges. */
  labelKey: string
  x1: number
  y1: number
  x2: number
  y2: number
  lx: number
  ly: number
}

export const MONEY_MAP_EDGES: MoneyMapEdge[] = [
  { labelKey: 'priced', x1: 100, y1: 62, x2: 245, y2: 118, lx: 148, ly: 92 },
  { labelKey: 'grants', x1: 460, y1: 62, x2: 315, y2: 118, lx: 412, ly: 92 },
  { labelKey: 'shownIn', x1: 280, y1: 166, x2: 280, y2: 222, lx: 312, ly: 196 },
]

// ─── recipes ("I want to…") ────────────────────────────────────────────────

export type PricingRecipeId =
  | 'sell-membership'
  | 'limit-weekly'
  | 'drop-in'
  | 'member-rate'
  | 'class-pack'
  | 'paid-trial'
  | 'appointments'
  | 'sell-course'
  | 'gift-cards'
  | 'no-show-fee'
  | 'partner-pass'

export interface PricingRecipeLink {
  href: string
  /** Label key under HowTo.pricing.linkLabels. */
  labelKey: string
}

export interface PricingRecipe {
  id: PricingRecipeId
  /** "Set it up" deep link(s) — 1 or 2 per recipe. */
  links: PricingRecipeLink[]
}

// Order matters: this is the order the goal chips render in.
export const PRICING_RECIPES: PricingRecipe[] = [
  { id: 'sell-membership', links: [{ href: '/offer/plans', labelKey: 'plans' }] },
  { id: 'limit-weekly', links: [{ href: '/offer/plans', labelKey: 'plans' }] },
  { id: 'drop-in', links: [{ href: '/offer/activities', labelKey: 'activities' }] },
  { id: 'member-rate', links: [{ href: '/offer/activities', labelKey: 'activities' }] },
  { id: 'class-pack', links: [{ href: '/offer/plans', labelKey: 'plans' }] },
  { id: 'paid-trial', links: [{ href: '/offer/activities', labelKey: 'activities' }] },
  { id: 'appointments', links: [{ href: '/offer/activities', labelKey: 'activities' }] },
  { id: 'sell-course', links: [{ href: '/manage/online-courses', labelKey: 'courses' }] },
  { id: 'gift-cards', links: [{ href: '/payments', labelKey: 'payments' }] },
  { id: 'no-show-fee', links: [{ href: '/settings/booking', labelKey: 'booking' }] },
  {
    id: 'partner-pass',
    links: [
      { href: '/offer/plans', labelKey: 'plans' },
      { href: '/offer/activities', labelKey: 'activities' },
    ],
  },
]

/** Always-present "Check it" link — the persona preview every recipe points at. */
export const PRICING_CHECK_LINK: PricingRecipeLink = { href: '/manage/pricing', labelKey: 'pricing' }
