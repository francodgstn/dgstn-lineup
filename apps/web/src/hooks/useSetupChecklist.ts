import { useQuery } from '@tanstack/react-query'
import { collection, query, where, limit, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  ACTIVITIES_COLLECTION,
  SESSIONS_COLLECTION,
  CONTACTS_COLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  INSTALLED_PLUGINS_SUBCOLLECTION,
  SUBSCRIPTION_TYPES_SUBCOLLECTION,
  type SaasPlan,
  type Team,
} from '@linyup/shared'

/**
 * THE SETUP CHECKLIST — what a studio has to do before it can open its doors.
 *
 * ── TWO RULES, BOTH LEARNED FROM STEPS THAT WERE LYING ──────────────────────
 *
 * 1. **A STEP MUST BE ABLE TO BE FALSE.** "Publish your bio link" checked
 *    whether `teams/{id}/public_profile/{id}` existed — and
 *    `syncTeamPublicProfile` is an `onDocumentWritten('teams/{teamId}')`
 *    trigger, so that document exists from the instant the team is created. The
 *    step had never been false for any studio, ever. It also started every
 *    progress bar at 1/5 before anybody had done anything.
 *
 * 2. **A STEP'S CHECK MUST MEAN WHAT ITS LABEL SAYS.** "Schedule a session"
 *    ticked on the existence of any session — and `allowBooking` defaults to
 *    FALSE, so the step went green with the door shut. The old hook computed
 *    `sessionsNotActuallyBookable` as a "UX-2 interim" and no surface ever
 *    rendered it. The requirement is now IN the step: a future session that
 *    people can actually book.
 *
 * ── THREE SECTIONS, AND ONLY TWO OF THEM COUNT ──────────────────────────────
 *
 *   offer   what you sell        counted
 *   doors   how people reach you counted
 *   extra   "Extra steps"        NOT counted — real work, but you can open
 *                                without it. Same argument as the dashboard
 *                                queue's housekeeping split. The label says
 *                                "extra" rather than naming a theme so that the
 *                                section itself explains why its rows are
 *                                missing from the count (Franco, 2026-08-23).
 *
 * ── TWO WAYS A STEP CAN END, AND THEY ARE NOT THE SAME ──────────────────────
 *
 * DERIVED (most steps): the studio did the thing, and we can see it. Cannot be
 * gamed, needs no new state, and is right wherever "leave it as it is" would be
 * a bad outcome — a bare public page, no activities.
 *
 * ACKNOWLEDGED (`ack`): the studio closes it by hand. Two kinds, because they
 * are two different sentences:
 *
 *   'skip'    "this does not apply to us" — a cash-only club never wants
 *             Stripe, a solo coach has nobody to invite. A permanent nag at
 *             somebody who has already decided is worse than no step at all.
 *   'review'  "I looked and it is right" — the only way a REVIEW step can end.
 *             There is nothing to observe about somebody having read a page,
 *             and inventing a signal would be the third lying step.
 *
 * An acknowledged step is drawn closed but visibly distinct from a completed
 * one; we never pretend they did the thing (Franco, 2026-08-23).
 *
 * ── PLAN-GATED STEPS STAY VISIBLE ───────────────────────────────────────────
 *
 * Signup provisions a STUDIO trial, so every studio meets the full list first.
 * When one later drops to Coach or Free, the steps their plan no longer
 * includes are not removed — they are muted, tagged, and stop counting. Removing
 * them would quietly rewrite what the product is while somebody is deciding
 * whether to pay for it.
 *
 * Ranks were here once and are not (UX-39): a martial-arts grading feature
 * advertised to every yoga studio that will never award one. Places were
 * considered and left out — the session form now prompts for one at the moment
 * a place is actually needed, which beats a fourth line here.
 */

export type SetupStepKey =
  | 'activities'
  | 'pricing'
  | 'sessions'
  | 'publicPage'
  | 'pricingReview'
  | 'payments'
  | 'branding'
  | 'bookingForm'
  | 'plugins'
  | 'coaches'

export type SetupSection = 'offer' | 'doors' | 'extra'

export interface SetupStep {
  key: SetupStepKey
  section: SetupSection
  done: boolean
  href: string
  /**
   * Never counted toward the bar. DERIVED from the section (`extra`), not
   * declared per step — two knobs that had to agree is one way for them to
   * disagree, and a step sitting in "Open the doors" while quietly not counting
   * would be unexplainable from the screen.
   */
  optional?: boolean
  /**
   * The step can be closed by hand, writing `setup_ack[key]`.
   *
   * TWO KINDS, because they are two different sentences and one label could not
   * say both. `'skip'` is "this does not apply to us" — a cash-only club, a solo
   * coach with nobody to invite. `'review'` is "I looked and it is right", which
   * is the ONLY way a review step can ever end: there is nothing to observe
   * about somebody having read a page.
   */
  ack?: 'skip' | 'review'
  /** Closed because the studio said it does not apply, not because they did it. */
  acknowledged?: boolean
  /** The plan this step needs. Below it the step is muted, tagged and uncounted. */
  requiresPlan?: SaasPlan
  /** Muted + uncounted: the current plan does not include this. */
  locked?: boolean
}

// Cheap existence check: read at most one doc from a top-level collection
// filtered by teamId.
async function teamCollectionHasAny(coll: string, teamId: string): Promise<boolean> {
  const snap = await getDocs(query(collection(db, coll), where('teamId', '==', teamId), limit(1)))
  return !snap.empty
}

async function subcollectionHasAny(teamId: string, sub: string, take = 1): Promise<number> {
  const snap = await getDocs(query(collection(db, TEAMS_COLLECTION, teamId, sub), limit(take)))
  return snap.size
}

/**
 * Is anything the studio sells actually PRICED?
 *
 * Two equality filters and no range, so the automatic single-field indexes
 * serve it — no composite index to add.
 */
async function hasPricedDropIn(teamId: string): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, ACTIVITIES_COLLECTION),
      where('teamId', '==', teamId),
      where('dropIn.enabled', '==', true),
      limit(1)
    )
  )
  return !snap.empty
}

/** A future session people can actually book — the thing "schedule a class" means. */
async function hasBookableFutureSession(teamId: string, nowTs: Timestamp): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, SESSIONS_COLLECTION),
      where('allowBooking', '==', true),
      where('teamId', '==', teamId),
      where('start', '>=', nowTs),
      limit(1)
    )
  )
  return !snap.empty
}

/**
 * Does the public page say anything about this studio?
 *
 * Read from the TEAM document the studio edits, not from the mirror — the
 * mirror is written by a trigger and is therefore always present (rule 1
 * above). The three signals are exactly the ones `provisionTeam` leaves empty:
 * it writes `description: ''`, two links with `url: ''`, and no image. So this
 * starts FALSE and turns true the moment there is something to read.
 */
function publicPageHasContent(team: Team | null | undefined): boolean {
  if (!team) return false
  if ((team.description ?? '').trim()) return true
  if (team.profileImage) return true
  if ((team.links ?? []).some((l) => (l.url ?? '').trim())) return true
  if ((team.socialLinks ?? []).some((l) => (l.url ?? '').trim())) return true
  return false
}

/** Logo or colours — the LOOK, as opposed to `publicPageHasContent`'s WORDS. */
function hasBranding(team: Team | null | undefined): boolean {
  return !!(team?.profileImage || team?.heroImage || team?.bioLinkAccentColor)
}

export function useSetupChecklist(teamId: string | null, team?: Team | null, plan?: SaasPlan) {
  const queryResult = useQuery({
    queryKey: ['setup-checklist', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const id = teamId as string
      const nowTs = Timestamp.now()
      const [
        activities,
        subscriptions,
        pricedDropIn,
        sessionsBookable,
        contacts,
        memberCount,
        installedPlugins,
      ] = await Promise.all([
          teamCollectionHasAny(ACTIVITIES_COLLECTION, id),
          subcollectionHasAny(id, SUBSCRIPTION_TYPES_SUBCOLLECTION),
          hasPricedDropIn(id),
          hasBookableFutureSession(id, nowTs),
          // NOT a step any more — the product's whole model is that contacts
          // arrive by themselves, through booking, the signup surface and the
          // shop, so telling a studio to type one in teaches the opposite. The
          // probe survives because the DASHBOARD still needs to know whether it
          // has anything to say on day one.
          teamCollectionHasAny(CONTACTS_COLLECTION, id),
          subcollectionHasAny(id, TEAM_MEMBERS_SUBCOLLECTION, 2),
          subcollectionHasAny(id, INSTALLED_PLUGINS_SUBCOLLECTION),
        ])

      return {
        activities,
        pricing: subscriptions > 0 || pricedDropIn,
        sessions: sessionsBookable,
        contacts,
        hasOtherMembers: memberCount > 1,
        hasPlugins: installedPlugins > 0,
      }
    },
  })

  const d = queryResult.data
  const ack = team?.setup_ack ?? {}
  const acked = (key: SetupStepKey) => !!ack[key]

  const raw: Array<Omit<SetupStep, 'acknowledged' | 'locked' | 'optional'>> = [
    // ── What you sell ────────────────────────────────────────────────────────
    {
      key: 'activities',
      section: 'offer',
      href: '/offer/activities',
      done: !!d?.activities,
    },
    {
      // Skippable because the probe cannot see every way a studio charges —
      // courses and products are plugin surfaces this hook deliberately does
      // not read — so a studio whose prices live somewhere else can close it
      // rather than be nagged by a step that is wrong about them.
      key: 'pricing',
      section: 'offer',
      href: '/offer/plans?tab=subscriptions',
      ack: 'skip',
      done: !!d?.pricing,
    },

    {
      // IN "WHAT YOU SELL", beside the prices, not with the doors: how you get
      // paid is part of composing the offer, and it is the step that decides
      // whether the price you just typed can ever be charged (Franco,
      // 2026-08-23).
      //
      // ALWAYS SHOWN, never silently required. A cash-only club is a legitimate
      // tenant and must be able to close this; a studio that means to take card
      // payments must not be able to miss that it has not — without a
      // chargeable Connect account `payments_enabled` fails closed, and the
      // shop, the per-class prices, priced trials and priced appointments all
      // silently disappear.
      key: 'payments',
      section: 'offer',
      href: '/settings/team?tab=payments',
      ack: 'skip',
      done: team?.payments?.connectStatus === 'enabled',
    },

    // ── Open the doors ───────────────────────────────────────────────────────
    { key: 'sessions', section: 'doors', href: '/schedule', done: !!d?.sessions },
    {
      key: 'publicPage',
      section: 'doors',
      href: '/team/bio-link',
      done: publicPageHasContent(team),
    },
    {
      // WHAT THE BOOKING FORM ASKS is part of opening the doors, not polish
      // (Franco, 2026-08-23): it is the last thing standing between somebody
      // and a booking, and a form asking for a date of birth nobody wanted is a
      // door that costs bookings rather than one that is merely unstyled.
      //
      // NO derived signal, deliberately: leaving the defaults is a perfectly
      // good answer, so there is nothing to observe. It closes on the studio
      // saying they have looked.
      key: 'bookingForm',
      section: 'doors',
      href: '/settings/booking',
      ack: 'review',
      done: false,
    },
    {
      // THE LAST LOOK BEFORE ANYBODY PAYS. /offer/pricing renders every price
      // as a member actually meets it — the plan, the per-class price, the
      // member rate on top of it — which is the one thing no individual editor
      // can show, because each of them only knows its own half.
      //
      // Pure acknowledgement, like the booking form: there is nothing to
      // observe about somebody having read a page, and pretending otherwise
      // would be the third lying step (Franco, 2026-08-23).
      key: 'pricingReview',
      section: 'doors',
      href: '/offer/pricing',
      ack: 'review',
      done: false,
    },

    // ── Make it yours (uncounted) ────────────────────────────────────────────
    {
      key: 'branding',
      section: 'extra',
      href: '/team/bio-link',
      ack: 'skip',
      done: hasBranding(team),
    },
    {
      // EXPLORING is the point, not installing — so it closes BOTH ways.
      // Installing one is proof they looked, and a studio that looked and
      // wanted none of them has finished this just as honestly; there is
      // nothing to observe about the second case, which is what the review
      // acknowledgement is for. `installed_plugins` starts empty on a new team
      // (nothing in `onTeamCreated` seeds it), so the derived half can be false.
      key: 'plugins',
      section: 'extra',
      href: '/settings/plugins',
      ack: 'review',
      done: !!d?.hasPlugins,
    },
    {
      key: 'coaches',
      section: 'extra',
      href: '/coaches',
      ack: 'skip',
      requiresPlan: 'studio',
      done: !!d?.hasOtherMembers,
    },
  ]

  const steps: SetupStep[] = raw.map((s) => {
    const locked = !!s.requiresPlan && !planAtLeast(plan, s.requiresPlan)
    const acknowledged = !s.done && acked(s.key)
    return {
      ...s,
      optional: s.section === 'extra',
      locked,
      acknowledged,
      done: s.done || acknowledged,
    }
  })

  // The bar counts the two sections that stand between a studio and its first
  // booking — and nothing a plan has taken away.
  const counted = steps.filter((s) => !s.optional && !s.locked)
  const requiredDone = counted.filter((s) => s.done).length
  const allRequiredDone = requiredDone === counted.length

  return {
    steps,
    requiredDone,
    requiredTotal: counted.length,
    allRequiredDone,
    /** Day one: the dashboard has nothing to say. Not "the checklist is unfinished". */
    hasContacts: !!d?.contacts,
    loading: queryResult.isLoading,
  }
}

/** Plan ordering, local to the one question this file asks. */
const PLAN_RANK: Record<SaasPlan, number> = { free: 0, coach: 1, studio: 2, organization: 3 }

function planAtLeast(plan: SaasPlan | undefined, min: SaasPlan): boolean {
  // Unknown plan is treated as sufficient: a step muted because the plan had
  // not loaded yet would flicker, and over-showing is the harmless direction.
  if (!plan) return true
  return PLAN_RANK[plan] >= PLAN_RANK[min]
}
