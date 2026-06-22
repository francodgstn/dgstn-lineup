/**
 * Canonical HMD Basel subscription types for the Linyup migration.
 *
 * Prices sourced from the published HMD Basel website pricing plans:
 *   C:\git\hmd\hmdbasel-website-astro\src\content\pricing-plans\en\
 *
 *   Essential:  CHF 60/month, CHF 600/year
 *   Students:   CHF 70/month, CHF 660/year
 *   Unlimited:  CHF 85/month, CHF 840/year
 *
 * Plus two special offers added for Linyup (not on the website at time of migration):
 *   Intro Offer:      CHF 100 one-time, 2 months all-inclusive
 *   One-time Class:   CHF 25  one-time, 1 class / 1 month
 *
 * SubscriptionRecurrence values must exactly match the union type in
 * packages/shared/src/types/contact.ts:
 *   'per_class' | 'one_time' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
 *
 * Shape mirrors SubscriptionType + SubscriptionPrice from that same file.
 * NOT imported from @linyup/shared — migration scripts are plain tsx, no monorepo imports.
 */

export interface MigrationSubscriptionPrice {
  id: string
  amount: number
  recurrence: string   // SubscriptionRecurrence value
  included_months?: number
  label?: string
  active: boolean
}

export interface MigrationSubscriptionType {
  id: string
  name: string
  description?: string
  active: boolean
  public: boolean
  order: number
  prices: MigrationSubscriptionPrice[]
}

export const CANONICAL_SUBSCRIPTION_TYPES: MigrationSubscriptionType[] = [
  {
    id:          'essential',
    name:        'Essential',
    description: 'Get started with one class per week',
    active:      true,
    public:      true,
    order:       1,
    prices: [
      {
        id:         'essential_monthly',
        amount:     60,
        recurrence: 'monthly',
        label:      'Monthly',
        active:     true,
      },
      {
        id:         'essential_annual',
        amount:     600,
        recurrence: 'annual',
        label:      'Annual',
        active:     true,
      },
    ],
  },
  {
    id:          'students',
    name:        'Students',
    description: 'Special rate for students — valid student ID required',
    active:      true,
    public:      true,
    order:       2,
    prices: [
      {
        id:         'students_monthly',
        amount:     70,
        recurrence: 'monthly',
        label:      'Monthly',
        active:     true,
      },
      {
        id:         'students_annual',
        amount:     660,
        recurrence: 'annual',
        label:      'Annual',
        active:     true,
      },
    ],
  },
  {
    id:          'unlimited',
    name:        'Unlimited',
    description: 'Train body and mind — access to all sessions',
    active:      true,
    public:      true,
    order:       3,
    prices: [
      {
        id:         'unlimited_monthly',
        amount:     85,
        recurrence: 'monthly',
        label:      'Monthly',
        active:     true,
      },
      {
        id:         'unlimited_annual',
        amount:     840,
        recurrence: 'annual',
        label:      'Annual',
        active:     true,
      },
    ],
  },
  {
    id:          'intro_offer',
    name:        'Intro Offer',
    description: '2 months all-inclusive — one-time welcome package',
    active:      true,
    public:      true,
    order:       4,
    prices: [
      {
        id:             'intro_offer_one_time',
        amount:         100,
        recurrence:     'one_time',
        included_months: 2,
        label:          '2 months all-inclusive',
        active:         true,
      },
    ],
  },
  {
    id:          'one_time_class',
    name:        'One-time Class',
    description: 'Drop-in single class',
    active:      true,
    public:      true,
    order:       5,
    prices: [
      {
        id:             'one_time_class_one_time',
        amount:         25,
        recurrence:     'one_time',
        included_months: 1,
        label:          'Single class',
        active:         true,
      },
    ],
  },
]

// ─── Contact subscription field matching ─────────────────────────────────────
//
// HEURISTIC — matches a contact's source `subscription_type_name` to the
// canonical types by case-insensitive keyword lookup. This is a best-effort
// approximation and MUST be validated against the real source data after migration.
//
// Match logic (evaluated in order; first match wins):
//   intro           → intro_offer
//   one / single / drop / drop.in / drop-in → one_time_class
//   unlimited       → unlimited
//   student(s)      → students
//   essential       → essential
//
// If no keyword matches, the contact's subscription fields are left unchanged.

type CanonicalMatch = {
  typeId:   string
  typeName: string
  prices:   MigrationSubscriptionPrice[]
}

const KEYWORD_MAP: Array<{ regex: RegExp; typeId: string }> = [
  { regex: /intro/i,                typeId: 'intro_offer'   },
  { regex: /one|single|drop/i,      typeId: 'one_time_class' },
  { regex: /unlimited/i,            typeId: 'unlimited'     },
  { regex: /students?/i,            typeId: 'students'      },
  { regex: /essential/i,            typeId: 'essential'     },
]

const TYPE_INDEX = new Map<string, MigrationSubscriptionType>(
  CANONICAL_SUBSCRIPTION_TYPES.map((t) => [t.id, t]),
)

/** Returns the canonical match for the given source subscription_type_name, or null. */
export function matchSubscriptionType(sourceName: string | undefined | null): CanonicalMatch | null {
  if (!sourceName) return null
  for (const { regex, typeId } of KEYWORD_MAP) {
    if (regex.test(sourceName)) {
      const type = TYPE_INDEX.get(typeId)!
      return { typeId, typeName: type.name, prices: type.prices }
    }
  }
  return null
}

/**
 * Given a matched canonical type and the source recurrence hint, returns the
 * best-matching price from that type's prices list.
 *
 * For types with a single price (intro_offer, one_time_class) the only price
 * is returned regardless of the recurrence hint.
 *
 * For types with monthly + annual prices:
 *   - If the source recurrence contains 'annual' or 'year', pick the annual price.
 *   - Otherwise default to monthly.
 */
export function pickSubscriptionPrice(
  prices: MigrationSubscriptionPrice[],
  sourceRecurrence: string | undefined | null,
): MigrationSubscriptionPrice {
  if (prices.length === 1) return prices[0]
  const hint = (sourceRecurrence ?? '').toLowerCase()
  const isAnnual = /annual|year/.test(hint)
  return prices.find((p) => p.recurrence === (isAnnual ? 'annual' : 'monthly')) ?? prices[0]
}
