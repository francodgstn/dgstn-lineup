'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
import { formatCurrency } from '@/lib/format'
import {
  Instagram,
  Facebook,
  Youtube,
  Twitter,
  Linkedin,
  Globe,
  MessageCircle,
  Star,
  Music2,
  MapPin,
  Phone,
  Mail,
  Clock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  List,
  ArrowRight,
  User,
  X,
} from 'lucide-react'
import type {
  WebsiteSection,
  OrgSiteSection,
  HeroSection,
  ContentSection,
  GallerySection,
  ActivitiesSection,
  PricingSection,
  ScheduleSection,
  ContactSection,
  PlacesSection,
  SocialLink,
  OrgSiteTeamRef,
} from '@linyup/shared'
import {
  browseDurationMinutes,
  compareActivities,
  mergeAvailabilitySlots,
  type ActivityAccessRule,
  type ActivityMemberBenefit,
} from '@linyup/shared'
import {
  resolveActivityTerms,
  resolveActivityPricingDisplay,
  type ActivityTerm,
  type SubLookup,
} from '@/lib/activityTerms'
import type { SitePalette } from './theme'
import { ctaHref } from './theme'
import { publicHrefLocalized, publicSubHrefLocalized } from '@/lib/publicRoutes'
import { IntroOfferLine, readIntroTerms } from '@/components/pricing/IntroOfferLine'
import type { BookIntent } from '@/components/booking/BookingOverlay'
import { usePlaces } from '@/hooks/usePlaces'
import { ClubsBlock, LocationsBlock, CoachesBlock } from './orgSections'
import { WeeklyCalendar } from '@/components/schedule/WeeklyCalendar'

export interface RenderCtx {
  palette: SitePalette
  slug: string
  /**
   * Active locale. These blocks emit RAW `<a href>` — they cannot use next-intl's
   * `Link`, because the same components render inside a cross-origin iframe
   * (app/[locale]/embed/…) where every anchor click is delegated to `window.open`,
   * and in the website builder with no router context. So the locale prefix has
   * to be baked into the href by `publicHrefLocalized`.
   */
  locale: string
  /** Team sites only (undefined for org sites — use `orgId`/`orgTeams` instead). */
  teamId?: string
  /** Org sites only. */
  orgId?: string
  /** Org sites only — the embedded member-team snapshot, used by the clubs/
   *  locations/coaches aggregate blocks to fetch each club's live public_profile. */
  orgTeams?: OrgSiteTeamRef[]
  preview: boolean
  /**
   * Whether the studio can actually BE PAID (TeamPublicProfile.payments_enabled).
   * Set by the LIVE team site, which resolves the team; absent on the builder
   * canvas, the org site and the embed, none of which do. A priced door is
   * advertised only when true — see the pricing lines in the activities block
   * (UX-33). Absent ⇒ treated as "unknown", and the prices are shown: the
   * builder must render the studio's own configuration back to it, and the org
   * site's activity blocks belong to member teams whose accounts differ.
   */
  paymentsEnabled?: boolean
  socialLinks?: SocialLink[]
  /**
   * Set only by the LIVE team site (`PublicSite`), which hosts the booking
   * overlay. When present, booking CTAs open the funnel in place instead of
   * navigating away.
   *
   * Absent everywhere else on purpose: the website builder's canvas and the
   * cross-origin embed both render these same blocks with no
   * `PublicTeamProvider`, and the overlay would throw there.
   */
  onBook?: (intent: BookIntent) => void
}

export const SOCIAL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  x: Twitter,
  linkedin: Linkedin,
  whatsapp: MessageCircle,
  website: Globe,
  review: Star,
  tiktok: Music2,
}

// In preview we never navigate away; on the live site links work normally.
function linkProps(href: string | undefined, preview: boolean, external = false) {
  if (!href) return { href: undefined }
  if (preview)
    return {
      href: undefined,
      onClick: (e: React.MouseEvent) => e.preventDefault(),
      style: { cursor: 'default' },
    }
  return external ? { href, target: '_blank' as const, rel: 'noopener noreferrer' } : { href }
}

// ─── Public-flow hrefs ───────────────────────────────────────────────────────
//
// Every link out of the website into a booking/shop flow goes through these.
// Two invariants, both easy to lose when hand-building template literals:
//   1. locale-PREFIXED — these render as raw <a> (see RenderCtx.locale)
//   2. `from: 'site'` — so the flow's back link returns to THIS website, not to
//      whatever surface the studio picked as its default landing.

/** Where an activity card's "Book" goes. Appointments have their own picker. */
function activityBookHref(
  ctx: RenderCtx,
  a: { id: string; slug?: string | null; activityType?: string },
  fallbackToBooking = false
): string | undefined {
  const { locale, slug } = ctx
  if (a.activityType === 'appointment')
    return publicHrefLocalized(locale, slug, 'appointments', { activity: a.id, from: 'site' })
  if (a.slug) return publicSubHrefLocalized(locale, slug, 'booking', a.slug, { from: 'site' })
  return fallbackToBooking
    ? publicHrefLocalized(locale, slug, 'booking', { from: 'site' })
    : undefined
}

/**
 * Where a CLICKED session goes: straight to that class at that time.
 *
 * The whole point of the schedule block. Until this existed the CTA was one
 * constant `/booking` for every row, so picking "Fri 18:00 Yoga" landed the
 * visitor on a blank activity picker and made them find it again.
 */
function sessionBookHref(ctx: RenderCtx, session: { id: string }): string {
  return publicHrefLocalized(ctx.locale, ctx.slug, 'booking', {
    session: session.id,
    from: 'site',
  })
}

/** Which funnel an activity card opens: the appointment picker, or classes. */
function activityIntent(a: {
  id: string
  slug?: string | null
  activityType?: string
}): BookIntent {
  return a.activityType === 'appointment'
    ? { kind: 'appointment', activityId: a.id }
    : { kind: 'activity', activitySlug: a.slug ?? '' }
}

/**
 * Anchor props for a booking CTA: opens the overlay when the host provides one
 * (`ctx.onBook`), otherwise a plain navigation to the canonical route.
 *
 * The `href` STAYS on the anchor even when onBook handles the click, and that is
 * load-bearing, not decoration:
 *   - middle-click / cmd-click / "open in new tab" keep working
 *   - crawlers keep the link into the booking page
 *   - the embed iframe's click delegation still has an anchor to read
 * Never turn these into bare <button>s.
 */
export function bookProps(href: string | undefined, ctx: RenderCtx, intent: BookIntent) {
  // Preview wins FIRST — the builder canvas stays inert no matter what.
  if (ctx.preview) return linkProps(undefined, true)
  if (!ctx.onBook || !href) return linkProps(href, ctx.preview)
  return {
    href,
    onClick: (e: React.MouseEvent) => {
      // Leave new-tab/new-window intents to the browser.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      ctx.onBook!(intent)
    },
  }
}

// ─── Hero ───────────────────────────────────────────────────────────────────

function HeroBlock({ section, ctx }: { section: HeroSection; ctx: RenderCtx }) {
  const { palette, slug, locale, preview } = ctx
  const href = ctaHref(section.cta, slug, locale)
  const center = section.align !== 'left'
  const overlay = (section.overlay ?? 40) / 100

  return (
    <section
      id={section.id}
      className="relative flex items-center"
      style={{
        minHeight: '72vh',
        background: section.bgImageUrl
          ? undefined
          : `linear-gradient(135deg, ${palette.accent}, ${palette.accent}99)`,
      }}
    >
      {section.bgImageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={section.bgImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${overlay})` }} />
        </>
      )}
      <div
        className={`relative mx-auto w-full max-w-5xl px-6 py-20 ${center ? 'text-center' : 'text-left'}`}
      >
        <h1
          className="text-4xl @2xl:text-5xl font-bold tracking-tight"
          style={{ color: '#ffffff', textShadow: '0 2px 18px rgba(0,0,0,0.35)' }}
        >
          {section.headline}
        </h1>
        {section.subheadline && (
          <p
            className={`mt-4 text-lg @2xl:text-xl ${center ? 'mx-auto max-w-2xl' : 'max-w-2xl'}`}
            style={{ color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 12px rgba(0,0,0,0.35)' }}
          >
            {section.subheadline}
          </p>
        )}
        {section.cta?.label && (
          <div className={`mt-8 flex ${center ? 'justify-center' : 'justify-start'}`}>
            <a
              // A 'booking' CTA opens the overlay; signup/external stay navigations.
              {...(section.cta.action === 'booking'
                ? bookProps(href, ctx, { kind: 'root' })
                : linkProps(href, preview, section.cta.action === 'url'))}
              className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-base font-semibold shadow-lg transition-transform hover:scale-[1.03]"
              style={{ background: palette.accent, color: palette.onAccent }}
            >
              {section.cta.label}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── shared section heading ─────────────────────────────────────────────────

function Heading({
  text,
  palette,
  center = true,
}: {
  text?: string
  palette: SitePalette
  center?: boolean
}) {
  if (!text) return null
  return (
    <h2
      className={`text-3xl font-bold tracking-tight ${center ? 'text-center' : ''}`}
      style={{ color: palette.text }}
    >
      {text}
    </h2>
  )
}

// ─── Content (generic rich-text block) ───────────────────────────────────────

function ContentBlock({ section, ctx }: { section: ContentSection; ctx: RenderCtx }) {
  const { palette } = ctx
  const imageRight = section.imageSide === 'right'
  return (
    <section id={section.id} className="py-20" style={{ background: palette.bg }}>
      <div className="mx-auto max-w-5xl px-6">
        <div className={`grid items-center gap-10 ${section.imageUrl ? '@3xl:grid-cols-2' : ''}`}>
          {section.imageUrl && imageRight && <ContentText section={section} palette={palette} />}
          {section.imageUrl && (
            <div className="overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={section.imageUrl} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          {(!section.imageUrl || !imageRight) && <ContentText section={section} palette={palette} />}
        </div>
      </div>
    </section>
  )
}

function ContentText({ section, palette }: { section: ContentSection; palette: SitePalette }) {
  return (
    <div>
      {section.heading && (
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: palette.text }}>
          {section.heading}
        </h2>
      )}
      {section.body && (
        // Body is rich HTML — sanitized at publish time. .site-prose styles it
        // with the site palette (color inherited; links use --site-accent).
        <div
          className={`site-prose leading-relaxed ${section.heading ? 'mt-4' : ''}`}
          style={{ color: palette.text, '--site-accent': palette.accent } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: section.body }}
        />
      )}
    </div>
  )
}

// ─── Gallery ────────────────────────────────────────────────────────────────

function GalleryBlock({ section, ctx }: { section: GallerySection; ctx: RenderCtx }) {
  const { palette } = ctx
  const cols =
    section.columns === 2
      ? '@2xl:grid-cols-2'
      : section.columns === 4
        ? '@2xl:grid-cols-2 @5xl:grid-cols-4'
        : '@2xl:grid-cols-2 @5xl:grid-cols-3'
  if (!section.images.length && !section.heading) return null
  return (
    <section id={section.id} className="py-20" style={{ background: palette.surface }}>
      <div className="mx-auto max-w-5xl px-6">
        <Heading text={section.heading} palette={palette} />
        <div className={`mt-10 grid grid-cols-1 gap-4 ${cols}`}>
          {section.images.map((img, i) => (
            <figure
              key={i}
              className="overflow-hidden rounded-xl"
              style={{ background: palette.bg }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.caption ?? ''}
                className="aspect-square w-full object-cover transition-transform hover:scale-105"
              />
              {img.caption && (
                <figcaption className="px-3 py-2 text-sm" style={{ color: palette.muted }}>
                  {img.caption}
                </figcaption>
              )}
            </figure>
          ))}
          {!section.images.length && (
            <p className="col-span-full text-center text-sm" style={{ color: palette.muted }}>
              No photos yet.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Activities (live: team public_profile mirrors, type 'activity') ──────────

interface ActivityEntry {
  id: string
  name: string
  slug: string
  /** Session category — 'appointment' activities book via the appointment flow. */
  activityType?: string
  description?: string
  color?: string
  imageUrl?: string
  level?: string
  isFreeTrial?: boolean
  order?: number
  /** CLASS-ONLY. */
  accessRule?: ActivityAccessRule
  /** CLASS-ONLY. */
  dropIn?: { enabled: boolean; priceAmount?: number }
  /** CLASS-ONLY: a gated class still accepts a newcomer's free trial booking. */
  trialEnabled?: boolean
  /** CLASS-ONLY: reduced trial price (major units). Absent/null ⇒ the trial is
   *  FREE (today's behaviour); a number ⇒ the trial costs that instead. */
  trialPriceAmount?: number | null
  /** APPOINTMENT-ONLY: priced duration menu (member pricing stripped). */
  durations?: Array<{ minutes: number; priceAmount: number | null }>
  /** APPOINTMENT-ONLY: the one member-benefit rule, mirrored verbatim. */
  memberBenefit?: ActivityMemberBenefit
}

// Public website chip labels are hardcoded English, matching this renderer's
// existing convention (it isn't i18n-aware — see the other literal strings in
// this block, e.g. "Free trial", "Book"). Benefit chips stay GENERIC (no plan
// names — the website has no subscription-type list loaded).
//
// MONEY TERMS ONLY. Its one caller (payPerVisitLine) filters to price / dropIn /
// benefit*, so a 'gate' or 'trial' term never arrives here; access is said in
// full on the activity CARD, not compressed into a chip on the pricing block.
// A gate arm lived here until 2026-08 and was unreachable the whole time.
function activityTermLabel(term: ActivityTerm, currency: string): string | null {
  switch (term.kind) {
    case 'dropIn':
      return `Drop-in ${formatCurrency(term.amount ?? 0, currency)}`
    case 'price':
      return term.min === term.max
        ? `From ${formatCurrency(term.min ?? 0, currency)}`
        : `${formatCurrency(term.min ?? 0, currency)}–${formatCurrency(term.max ?? 0, currency)}`
    case 'benefitIncluded':
      return 'Included with subscription'
    case 'benefitDiscount':
      return `−${term.percent ?? 0}% for members`
    default:
      return null
  }
}

// Activities with an actual "pay per visit" money story — a priced appointment
// duration, or a priced drop-in on a class. Mirrors the shop's hasMoneyStory:
// a bare gated/trial class or an unpriced (free) appointment has nothing to sell
// per visit, so it never appears on the Pricing block's pay-per-visit card.
function activityHasMoneyStory(a: ActivityEntry): boolean {
  if (a.activityType === 'appointment') {
    return (a.durations ?? []).some((d) => typeof d.priceAmount === 'number')
  }
  return a.dropIn?.enabled === true && typeof a.dropIn.priceAmount === 'number'
}

// One activity's money terms as a "·"-joined line (price / drop-in / member
// benefit) for the Pricing block's pay-per-visit card. Generic labels — the
// website has no subscription-type list, same convention as the chips.
function payPerVisitLine(a: ActivityEntry, currency: string): string {
  return resolveActivityTerms({
    type: a.activityType,
    dropIn: a.dropIn,
    durations: a.durations,
    memberBenefit: a.memberBenefit,
    accessRule: a.accessRule,
  })
    .filter(
      (term) => term.kind === 'price' || term.kind === 'dropIn' || term.kind.startsWith('benefit')
    )
    .map((term) => activityTermLabel(term, currency))
    .filter((l): l is string => !!l)
    .join(' · ')
}

function ActivitiesBlock({ section, ctx }: { section: ActivitiesSection; ctx: RenderCtx }) {
  // slug/locale/preview are read from `ctx` by activityBookHref and bookProps —
  // not needed directly here.
  const { palette, teamId } = ctx
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [currency, setCurrency] = useState('CHF')
  // Subscription plans (id → name + price) so a card can name which plan includes
  // it — "Included with Premium — CHF 89/mo". Same aggregator the Pricing block reads.
  const [subPlans, setSubPlans] = useState<PlanEntry[]>([])
  const [loading, setLoading] = useState(true)

  const subLookup = useMemo<SubLookup>(() => {
    const byId = new Map(subPlans.map((p) => [p.id, p]))
    return (id: string) => {
      const p = byId.get(id)
      if (!p) return null
      const price = p.prices?.[0]
      return {
        id: p.id,
        name: p.name,
        priceLabel: price
          ? `${formatCurrency(price.amount, currency)}${RECURRENCE_SUFFIX[price.recurrence] ?? ''}`
          : null,
      }
    }
  }, [subPlans, currency])

  useEffect(() => {
    let alive = true
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('teamId', '==', teamId),
      where('type', '==', 'activity')
    )
    Promise.all([getDocs(q), getDoc(doc(db, 'teams', teamId!, 'public_profile', teamId!))])
      .then(([snap, teamSnap]) => {
        if (!alive) return
        const list = snap.docs
          .map((d) => {
            const data = d.data()
            return {
              id: d.id,
              name: (data.name as string) || '',
              slug: (data.slug as string) || '',
              activityType: (data.activityType as string) || undefined,
              description: (data.description as string) || undefined,
              color: (data.color as string) || undefined,
              imageUrl: (data.image_url as string) || undefined,
              level: (data.level as string) || undefined,
              isFreeTrial: Boolean(data.isFreeTrial),
              order: typeof data.order === 'number' ? (data.order as number) : undefined,
              accessRule: (data.accessRule as ActivityAccessRule | undefined) ?? undefined,
              dropIn: (data.dropIn as ActivityEntry['dropIn']) ?? undefined,
              trialEnabled: data.trialEnabled === true,
              trialPriceAmount: typeof data.trialPriceAmount === 'number' ? (data.trialPriceAmount as number) : null,
              durations: Array.isArray(data.durations) ? (data.durations as ActivityEntry['durations']) : undefined,
              memberBenefit: (data.memberBenefit as ActivityMemberBenefit | undefined) ?? undefined,
            }
          })
          .filter((a) => a.name)
          .sort(compareActivities)
        setActivities(list)
        setCurrency((teamSnap.data()?.default_currency as string | undefined) ?? 'CHF')
        setSubPlans((teamSnap.data()?.aggregator_subscription_types as PlanEntry[] | undefined) ?? [])
      })
      .catch((err: unknown) => {
        // A public marketing page: an empty activities block reads as "this
        // studio teaches nothing". Keep the terminal state, lose the silence.
        reportPublicLoadFailure('site/activities', err)
        if (alive) setActivities([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [teamId])

  // Two arrangements of the SAME card. Only the wrapper direction and the image
  // box differ — the body (chips, pricing rows, CTA) is shared, so the two can't
  // drift apart.
  const isList = section.layout === 'list'
  const cols =
    section.columns === 2
      ? '@2xl:grid-cols-2'
      : section.columns === 4
        ? '@2xl:grid-cols-2 @5xl:grid-cols-4'
        : '@2xl:grid-cols-2 @5xl:grid-cols-3'
  // List: one full-width row per activity, image left. Container queries (not
  // viewport ones) because this also renders inside the embed iframe, where the
  // frame — not the window — is what the layout must respond to.
  const containerClass = isList
    ? 'mt-10 flex flex-col gap-4'
    : `mt-10 grid grid-cols-1 gap-5 ${cols}`
  // Side-by-side only once there's room; below that a list row stacks like a card.
  const cardClass = isList
    ? 'flex flex-col overflow-hidden rounded-2xl border @2xl:flex-row'
    : 'flex flex-col overflow-hidden rounded-2xl border'
  const mediaClass = isList
    ? 'relative aspect-[4/3] w-full shrink-0 @2xl:aspect-auto @2xl:w-56 @4xl:w-72'
    : 'relative aspect-[4/3] w-full'

  return (
    <section id={section.id} className="py-20" style={{ background: palette.bg }}>
      <div className="mx-auto max-w-5xl px-6">
        <Heading text={section.heading ?? 'What we offer'} palette={palette} />
        {section.subheading && (
          <p className="mt-3 text-center" style={{ color: palette.muted }}>
            {section.subheading}
          </p>
        )}
        <div className={containerClass}>
          {loading ? (
            <p className="col-span-full text-center text-sm" style={{ color: palette.muted }}>
              Loading…
            </p>
          ) : activities.length === 0 ? (
            <p className="col-span-full text-center text-sm" style={{ color: palette.muted }}>
              No activities yet.
            </p>
          ) : (
            activities.map((a) => {
              // Appointments book via their own flow (per-coach slot picker).
              const href = section.showBooking ? activityBookHref(ctx, a) : undefined
              // Structured commercial display (locked with the user): Free trial
              // stays a ribbon on the image; the card shows a type chip (Class /
              // Appointment) + NAMED pricing lines ("Included with {sub} — {price}",
              // "Discount with {sub} — {%}", drop-in, appointment price). No generic
              // "Subscription required" chip — where a plan IS the key it is named,
              // with its price. The one exception is the 'members' tier below,
              // where there is no plan to name because none is required.
              const d = resolveActivityPricingDisplay({ ...a, type: a.activityType }, subLookup)
              const pricingLines: string[] = []
              // A 'members'-tier class (the DEFAULT for every new class) used to
              // render nothing at all here: a name, a "Class" chip and a Book
              // link, with no hint that membership is required — on the surface a
              // prospect reaches earliest. It gets a line now, and the line names
              // the gate that is enforced (being signed up) rather than a plan
              // price nobody has to pay to book it. See `signedUpOnly`.
              if (d.signedUpOnly) pricingLines.push('Members only — signing up is free')
              for (const s of d.includedWith)
                pricingLines.push(s.priceLabel ? `Included with ${s.name} — ${s.priceLabel}` : `Included with ${s.name}`)
              for (const s of d.discountWith) pricingLines.push(`Discount with ${s.name} — ${s.percent}%`)
              // A price is only advertised where somebody could pay it. `false`
              // is a resolved "this studio has no chargeable account"; undefined
              // is "not resolved here" (builder / org site / embed) and keeps
              // the previous behaviour. See RenderCtx.paymentsEnabled.
              const showPrices = ctx.paymentsEnabled !== false
              if (d.dropInAmount != null && showPrices)
                pricingLines.push(`Drop-in ${formatCurrency(d.dropInAmount, currency)}`)
              if (d.appointmentPrice && showPrices)
                pricingLines.push(
                  d.appointmentPrice.min === d.appointmentPrice.max
                    ? `From ${formatCurrency(d.appointmentPrice.min, currency)}`
                    : `${formatCurrency(d.appointmentPrice.min, currency)}–${formatCurrency(d.appointmentPrice.max, currency)}`
                )
              return (
                <div
                  key={a.id}
                  className={cardClass}
                  style={{ borderColor: palette.border, background: palette.surface }}
                >
                  <div
                    className={mediaClass}
                    style={{ background: a.color || palette.accent }}
                  >
                    {a.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={a.imageUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span
                          className="text-4xl font-bold"
                          style={{ color: '#ffffff', opacity: 0.92 }}
                        >
                          {a.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    {d.trial && (
                      <span
                        className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold shadow"
                        style={{ background: palette.accent, color: palette.onAccent }}
                      >
                        {d.trial.priceAmount != null
                          ? `Trial ${formatCurrency(d.trial.priceAmount, currency)}`
                          : 'Free trial'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold" style={{ color: palette.text }}>
                        {a.name}
                      </h3>
                      {/* Type chip — Class or Appointment */}
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs"
                        style={{ borderColor: palette.border, color: palette.muted }}
                      >
                        {d.type === 'appointment' ? 'Appointment' : 'Class'}
                      </span>
                    </div>
                    {a.description && (
                      <p className="mt-2 flex-1 text-sm" style={{ color: palette.muted }}>
                        {a.description}
                      </p>
                    )}
                    {/* Each way to pay is its own row with a hairline between, so a
                        card offering a subscription AND a drop-in AND a trial reads
                        as a list rather than a paragraph of prices. Rules take the
                        site palette, not Tailwind's divide-* (colours are per-site). */}
                    {pricingLines.length > 0 && (
                      <div className="mt-3 border-t" style={{ borderColor: palette.border }}>
                        {pricingLines.map((line, i) => (
                          <p
                            key={i}
                            className={`py-1.5 text-sm${i > 0 ? ' border-t' : ''}`}
                            style={{ color: palette.muted, borderColor: palette.border }}
                          >
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                    {href && (
                      <a
                        // Both kinds open the overlay: the panel hosts the class
                        // funnel or the appointment picker depending on intent.
                        {...bookProps(href, ctx, activityIntent(a))}
                        className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-semibold transition-opacity hover:opacity-70"
                        style={{ color: palette.accent }}
                      >
                        Book
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Pricing (live: team public_profile.aggregator_subscription_types) ────────

interface PlanPrice {
  id?: string
  amount: number
  recurrence: string
  label?: string
  included_months?: number
  /** The plan's INTRO OFFER on this price (resolved server-side by
   *  syncSubscriptionTypesToPublicProfile). Rendered through the same
   *  `IntroOfferLine` the shop uses — one discount, one sentence. */
  intro?: unknown
}

interface PlanEntry {
  id: string
  name: string
  description?: string
  prices?: PlanPrice[]
}

// Short, public-facing recurrence suffixes (this renderer is not i18n-aware).
const RECURRENCE_SUFFIX: Record<string, string> = {
  per_class: '/class',
  weekly: '/week',
  biweekly: '/2 weeks',
  monthly: '/mo',
  quarterly: '/quarter',
  annual: '/yr',
}

function PricingBlock({ section, ctx }: { section: PricingSection; ctx: RenderCtx }) {
  const { palette, slug, locale, teamId, preview } = ctx
  const [plans, setPlans] = useState<PlanEntry[]>([])
  // Pay-per-visit activities (priced drop-ins + priced appointments) — the same
  // "additional lines" the shop shows under Subscriptions, surfaced here as a
  // card so the website's pricing isn't subscriptions-only.
  const [ppvActivities, setPpvActivities] = useState<ActivityEntry[]>([])
  const [currency, setCurrency] = useState('CHF')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // PricingBlock only ever renders inside a team site (org sites have no
    // 'pricing' section type), so teamId is always defined here. Plans live on
    // the team's single public_profile doc; the pay-per-visit prices come from
    // the per-activity mirrors (same query the Activities block reads).
    const planP = getDoc(doc(db, 'teams', teamId!, 'public_profile', teamId!))
    const actP = getDocs(
      query(
        collectionGroup(db, 'public_profile'),
        where('teamId', '==', teamId),
        where('type', '==', 'activity')
      )
    )
    Promise.all([planP, actP])
      .then(([snap, actSnap]) => {
        if (!alive) return
        const list = (snap.data()?.aggregator_subscription_types ?? []) as PlanEntry[]
        setPlans(Array.isArray(list) ? list : [])
        setCurrency((snap.data()?.default_currency as string | undefined) ?? 'CHF')
        const acts = actSnap.docs
          .map(
            (d) =>
              ({
                id: d.id,
                name: (d.data().name as string) || '',
                slug: (d.data().slug as string) || '',
                activityType: (d.data().activityType as string) || undefined,
                order: typeof d.data().order === 'number' ? (d.data().order as number) : undefined,
                accessRule: (d.data().accessRule as ActivityAccessRule | undefined) ?? undefined,
                dropIn: (d.data().dropIn as ActivityEntry['dropIn']) ?? undefined,
                durations: Array.isArray(d.data().durations)
                  ? (d.data().durations as ActivityEntry['durations'])
                  : undefined,
                memberBenefit: (d.data().memberBenefit as ActivityMemberBenefit | undefined) ?? undefined,
              }) as ActivityEntry
          )
          .filter((a) => a.name && activityHasMoneyStory(a))
          .sort(compareActivities)
        setPpvActivities(acts)
      })
      .catch((err: unknown) => {
        reportPublicLoadFailure('site/pricing', err)
        if (alive) {
          setPlans([])
          setPpvActivities([])
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [teamId])

  return (
    <section id={section.id} className="py-20" style={{ background: palette.bg }}>
      <div className="mx-auto max-w-5xl px-6">
        <Heading text={section.heading ?? 'Pricing'} palette={palette} />
        {section.subheading && (
          <p className="mt-3 text-center" style={{ color: palette.muted }}>
            {section.subheading}
          </p>
        )}
        <div className="mt-10 grid grid-cols-1 gap-5 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {loading ? (
            <p className="col-span-full text-center text-sm" style={{ color: palette.muted }}>
              Loading…
            </p>
          ) : plans.length === 0 ? (
            <p className="col-span-full text-center text-sm" style={{ color: palette.muted }}>
              No plans available yet.
            </p>
          ) : (
            plans.map((p) => (
              <div
                key={p.id}
                className="flex flex-col rounded-2xl border p-6"
                style={{ borderColor: palette.border, background: palette.surface }}
              >
                <h3 className="text-lg font-semibold" style={{ color: palette.text }}>
                  {p.name}
                </h3>
                {p.prices && p.prices.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {p.prices.map((pr, i) => {
                      const intro = readIntroTerms(pr.intro)
                      return (
                        <div key={i}>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-bold" style={{ color: palette.text }}>
                              {formatCurrency(pr.amount, currency)}
                            </span>
                            <span className="text-sm" style={{ color: palette.muted }}>
                              {RECURRENCE_SUFFIX[pr.recurrence] ?? ''}
                              {pr.label ? ` · ${pr.label}` : ''}
                            </span>
                          </div>
                          {/* The offer, stated on the card the visitor decides
                              from. This block's own chrome is deliberately not
                              translated; the intro sentence IS, because it is a
                              price promise and a mistranslated one is a lie. */}
                          {intro && (
                            <p className="mt-1 text-sm font-semibold" style={{ color: palette.accent }}>
                              <IntroOfferLine
                                intro={intro}
                                fullAmount={pr.amount}
                                recurrence={pr.recurrence}
                                currency={currency}
                              />
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {p.description && (
                  <p className="mt-2 flex-1 text-sm" style={{ color: palette.muted }}>
                    {p.description}
                  </p>
                )}
                <a
                  {...linkProps(
                    preview
                      ? undefined
                      : publicHrefLocalized(locale, slug, 'shop', { type: p.id, from: 'site' }),
                    preview
                  )}
                  className="mt-5 inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.02]"
                  style={{ background: palette.accent, color: palette.onAccent }}
                >
                  {section.ctaLabel ?? 'Join now'}
                </a>
              </div>
            ))
          )}
        </div>
        {/* Pay per visit — the drop-in + appointment prices that aren't
            subscriptions. One card, each activity a row with its price line and
            a Book CTA into the right flow (appointments → picker, class → the
            activity's booking). */}
        {!loading && ppvActivities.length > 0 && (
          <div
            className="mt-6 rounded-2xl border p-6"
            style={{ borderColor: palette.border, background: palette.surface }}
          >
            <h3 className="text-lg font-semibold" style={{ color: palette.text }}>
              Pay per visit
            </h3>
            <p className="mt-1 text-sm" style={{ color: palette.muted }}>
              Book single classes and appointments — no subscription needed.
            </p>
            <div className="mt-4 space-y-3">
              {ppvActivities.map((a) => {
                const line = payPerVisitLine(a, currency)
                const href = activityBookHref(ctx, a, true)
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-4 border-t pt-3 first:border-t-0 first:pt-0"
                    style={{ borderColor: palette.border }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: palette.text }}>
                        {a.name}
                      </p>
                      {line && (
                        <p className="mt-0.5 text-xs" style={{ color: palette.muted }}>
                          {line}
                        </p>
                      )}
                    </div>
                    <a
                      {...bookProps(href, ctx, activityIntent(a))}
                      className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:scale-[1.02]"
                      style={{ background: palette.accent, color: palette.onAccent }}
                    >
                      Book
                    </a>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!loading && plans.length > 0 && (
          <div className="mt-8 text-center">
            <a
              {...linkProps(
                preview ? undefined : publicHrefLocalized(locale, slug, 'shop', { from: 'site' }),
                preview
              )}
              className="text-sm font-medium underline-offset-4 hover:underline"
              style={{ color: palette.muted }}
            >
              View all options →
            </a>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Schedule (live: upcoming bookable sessions) ──────────────────────────────

/** The slice of `listAvailability`'s payload the schedule needs. */
interface AvailCoachLite {
  providerId: string
  providerName: string | null
  activities: {
    activityId: string
    activityName: string
    durations: { minutes: number }[]
    location: string | null
    days: { dayMs: number; slotsByDuration: Record<string, number[]> }[]
  }[]
}

interface SessionEntry {
  id: string
  activityName?: string
  activityColor?: string
  activityId?: string
  start: Timestamp
  end?: Timestamp
  location?: string
  providerName?: string
  /**
   * 'session' — a scheduled class, bookable at exactly this time.
   * 'availability' — a merged window in which an appointment CAN be booked;
   * the visitor still picks the exact start in the appointment picker.
   *
   * Absent ⇒ 'session', so the kiosk and existing call sites are unaffected.
   */
  variant?: 'session' | 'availability'
  /** Availability only — whose time this window is, so the picker can preselect. */
  providerId?: string
}

/** Timestamp-alike over a plain epoch, so merged windows reuse the session render path. */
function msTimestamp(ms: number): Timestamp {
  return Timestamp.fromMillis(ms)
}

// Group sorted sessions into ordered per-day buckets (used by the list dividers).
interface DayGroup {
  key: string // YYYY-MM-DD
  date: Date
  sessions: SessionEntry[]
}
function groupByDay(sessions: SessionEntry[]): DayGroup[] {
  const groups = new Map<string, DayGroup>()
  for (const s of sessions) {
    const d = s.start.toDate()
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let g = groups.get(key)
    if (!g) {
      g = { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), sessions: [] }
      groups.set(key, g)
    }
    g.sessions.push(s)
  }
  return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
}

const fmtTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Local YYYY-MM-DD — the same day-key form MiniCalendar and `?date=` use. */
function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Midnight Monday of the current week — the timetable's lower bound. */
function mondayOfCurrentWeek(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

const isPastSession = (s: SessionEntry) =>
  (s.end ?? s.start).toDate().getTime() < Date.now()

function ScheduleBlock({ section, ctx }: { section: ScheduleSection; ctx: RenderCtx }) {
  const { palette, slug, locale, teamId, preview } = ctx
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [loading, setLoading] = useState(true)
  // Studio sets the default view; visitors can switch with the toggle below.
  const [view, setView] = useState<'list' | 'calendar'>(section.displayMode ?? 'calendar')
  const [selected, setSelected] = useState<SessionEntry | null>(null)
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null)
  // Merged appointment availability, loaded separately (see the effect below).
  const [availability, setAvailability] = useState<SessionEntry[]>([])
  const [kind, setKind] = useState<'all' | 'classes' | 'appointments'>('all')

  useEffect(() => {
    let alive = true
    const windowEnd = new Date()
    windowEnd.setDate(windowEnd.getDate() + (section.windowDays ?? 7))
    // This query is CLASSES only, deliberately: appointments are availability-
    // only (a Session exists only once booked), so the only appointment_session
    // mirrors that exist are ALREADY-BOOKED appointments — listing those as
    // bookable would be wrong. Appointment availability comes from
    // listAvailability in the effect below instead. The lower bound is Monday of
    // the CURRENT week (not "now"): the calendar doubles as a timetable, showing
    // this week's already-run sessions muted.
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('teamId', '==', teamId),
      where('type', '==', 'session'),
      where('allowBooking', '==', true),
      where('start', '>=', Timestamp.fromDate(mondayOfCurrentWeek())),
      orderBy('start', 'asc'),
      limit(200)
    )
    getDocs(q)
      .then((snap) => {
        if (!alive) return
        const list = snap.docs
          .map((d) => ({ ...(d.data() as Omit<SessionEntry, 'id'>), id: d.id }))
          .filter((s) => s.start && s.start.toDate() <= windowEnd)
          .filter((s) => !section.activityId || s.activityId === section.activityId)
        setSessions(list)
      })
      .catch((err: unknown) => {
        reportPublicLoadFailure('site/schedule', err)
        if (alive) setSessions([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [teamId, section.windowDays, section.activityId])

  // ── Appointment availability ────────────────────────────────────────────────
  //
  // Two-step on purpose. `listAvailability` is a Cloud Function, and a public
  // marketing page can be hit a lot — so first check the (cheap, SDK-cached)
  // activity mirrors for an appointment offering, and only invoke the callable
  // for teams that actually have one. A classes-only studio pays nothing.
  useEffect(() => {
    if (preview || !teamId) return
    let alive = true
    const windowDays = section.windowDays ?? 7
    const windowEnd = Date.now() + windowDays * 24 * 60 * 60_000

    async function load() {
      const offerings = await getDocs(
        query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('type', '==', 'activity'),
          where('activityType', '==', 'appointment')
        )
      )
      if (!alive || offerings.empty) return

      const fn = httpsCallable<
        { teamId: string; days?: number; activityId?: string },
        { coaches: AvailCoachLite[] }
      >(functions, 'listAvailability')
      const res = await fn({
        teamId: teamId!,
        days: windowDays,
        ...(section.activityId ? { activityId: section.activityId } : {}),
      })
      if (!alive) return

      const entries: SessionEntry[] = []
      for (const coach of res.data.coaches ?? []) {
        for (const activity of coach.activities ?? []) {
          // Browse by the SHORTEST duration — the most granular starts, and so
          // the widest true window. Picking an exact length is the picker's job.
          const minutes = browseDurationMinutes(activity.durations)
          if (!minutes) continue
          const starts = (activity.days ?? []).flatMap(
            (d) => d.slotsByDuration?.[String(minutes)] ?? []
          )
          for (const w of mergeAvailabilitySlots(starts, minutes)) {
            if (w.startMs > windowEnd) continue
            entries.push({
              id: `avail-${coach.providerId}-${activity.activityId}-${w.startMs}`,
              activityId: activity.activityId,
              providerId: coach.providerId,
              activityName: activity.activityName,
              providerName: coach.providerName ?? undefined,
              location: activity.location ?? undefined,
              start: msTimestamp(w.startMs),
              end: msTimestamp(w.endMs),
              variant: 'availability',
            })
          }
        }
      }
      if (alive) setAvailability(entries)
    }

    load().catch((err: unknown) => {
      // Availability is additive — a failure leaves the classes schedule intact.
      reportPublicLoadFailure('site/availability', err)
      if (alive) setAvailability([])
    })
    return () => {
      alive = false
    }
  }, [teamId, section.windowDays, section.activityId, preview])

  //
  // The section-level CTA ("Book a session") is a browse entry: no session in
  // hand, but it does carry the block's activity filter when it has one — a
  // schedule scoped to Yoga should open Yoga's calendar, not the full picker.
  // A CLICKED session gets `sessionBookHref` instead (see the modal below).
  const browseBookHref = preview
    ? undefined
    : publicHrefLocalized(locale, slug, 'booking', {
        activity: section.activityId || undefined,
        from: 'site',
      })

  // Classes and appointment availability share one timeline; the chips below
  // narrow it. Chips only appear when the team has BOTH — a classes-only studio
  // shouldn't be shown a filter with one meaningful option.
  const hasAvailability = availability.length > 0
  const showKindChips = hasAvailability && sessions.length > 0
  const visibleEntries = useMemo(() => {
    const wanted =
      kind === 'classes' ? sessions : kind === 'appointments' ? availability : [...sessions, ...availability]
    return [...wanted].sort((a, b) => a.start.toMillis() - b.start.toMillis())
  }, [kind, sessions, availability])

  // Daily list covers today onward (today's finished sessions render muted);
  // the calendar additionally shows the current week's past days as a timetable.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const listDays = groupByDay(visibleEntries.filter((s) => s.start.toDate() >= startOfToday))
  const activeDay = listDays.find((g) => g.key === activeDayKey) ?? listDays[0]
  const today = new Date()
  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  // Kiosk-style daily list: selectable day chips on top, that day's sessions
  // below — a full multi-day list is unwieldy on a website.
  const DailyList = () => (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {listDays.map((g) => {
          const active = g.key === activeDay?.key
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveDayKey(g.key)}
              aria-pressed={active}
              className="flex min-w-[3.75rem] shrink-0 flex-col items-center rounded-xl border px-3 py-2 transition-colors"
              style={
                active
                  ? { background: palette.accent, borderColor: palette.accent, color: palette.onAccent }
                  : { background: palette.bg, borderColor: palette.border, color: palette.text }
              }
            >
              <span
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={active ? undefined : { color: palette.muted }}
              >
                {isToday(g.date)
                  ? 'Today'
                  : g.date.toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <span className="text-base font-bold tabular-nums">{g.date.getDate()}</span>
            </button>
          )
        })}
      </div>
      <div className="space-y-2.5">
        {/* Optional per-day cap (0/unset = all of the day). */}
        {(section.maxItems
          ? (activeDay?.sessions ?? []).slice(0, section.maxItems)
          : (activeDay?.sessions ?? [])
        ).map((s) => {
          const past = isPastSession(s)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s)}
              className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition-opacity hover:opacity-80 ${past ? 'opacity-50' : ''}`}
              style={{ borderColor: palette.border, background: palette.bg }}
            >
              <div
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ background: s.activityColor || palette.accent }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: palette.text }}>
                  {s.activityName ?? 'Session'}
                  {s.providerName ? ` · ${s.providerName}` : ''}
                </p>
                {s.location && (
                  <p className="text-xs" style={{ color: palette.muted }}>
                    {s.location}
                  </p>
                )}
              </div>
              <p className="text-sm shrink-0 tabular-nums" style={{ color: palette.text }}>
                {fmtTime(s.start.toDate())}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )


  const ToggleButton = ({
    mode,
    icon: Icon,
    label,
  }: {
    mode: 'list' | 'calendar'
    icon: typeof List
    label: string
  }) => {
    const active = view === mode
    return (
      <button
        type="button"
        onClick={() => setView(mode)}
        aria-label={label}
        aria-pressed={active}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
        style={
          active
            ? { background: palette.accent, color: palette.onAccent }
            : { color: palette.muted }
        }
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
    )
  }

  return (
    <section id={section.id} className="py-20" style={{ background: palette.surface }}>
      {/* Calendar view needs room for the 7-day grid; list view stays a tidy reading width. */}
      <div className={`mx-auto px-6 ${view === 'calendar' ? 'max-w-5xl' : 'max-w-3xl'}`}>
        <Heading text={section.heading ?? 'Schedule'} palette={palette} />

        <div className="mt-4 flex justify-center">
          <div
            className="inline-flex items-center gap-1 rounded-full border p-1"
            style={{ borderColor: palette.border }}
          >
            <ToggleButton mode="list" icon={List} label="Daily list" />
            <ToggleButton mode="calendar" icon={CalendarRange} label="Calendar" />
          </div>
        </div>

        {/* Classes vs appointment availability. Defaults to All so a visitor
            sees everything without having to discover the filter; only shown
            when the team actually has both to choose between. */}
        {showKindChips && (
          <div className="mt-3 flex justify-center">
            <div
              className="inline-flex items-center gap-1 rounded-full border p-1"
              style={{ borderColor: palette.border }}
            >
              {(['all', 'classes', 'appointments'] as const).map((k) => {
                const active = kind === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={active}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors"
                    style={
                      active
                        ? { background: palette.accent, color: palette.onAccent }
                        : { color: palette.muted }
                    }
                  >
                    {k}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-8">
          {loading ? (
            <p className="text-center text-sm" style={{ color: palette.muted }}>
              Loading…
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-center text-sm" style={{ color: palette.muted }}>
              No upcoming sessions.
            </p>
          ) : view === 'calendar' ? (
            // WeeklyCalendar is shared with the kiosk and styles its chrome with
            // app theme tokens (bg-background, border, muted…). On the public site
            // those must follow the studio's palette, not the viewer's app light/
            // dark mode — otherwise the hour axis renders dark on a light site.
            // Remapping the CSS vars here (they cascade via @theme inline) pins the
            // calendar to the site palette regardless of the global theme.
            <div
              style={
                {
                  '--background': palette.surface,
                  '--foreground': palette.text,
                  '--muted': palette.border,
                  '--muted-foreground': palette.muted,
                  '--border': palette.border,
                  '--primary': palette.accent,
                  color: palette.text,
                } as CSSProperties
              }
            >
              <WeeklyCalendar
                sessions={visibleEntries}
                accent={palette.accent}
                windowDays={section.windowDays ?? 7}
                onSelect={(s) => setSelected(s as SessionEntry)}
              />
            </div>
          ) : (
            <DailyList />
          )}
        </div>

        {selected && (
          <SessionDetailModal
            s={selected}
            palette={palette}
            bookLinkProps={
              section.showBooking && !isPastSession(selected) && !preview
                ? selected.variant === 'availability'
                  ? // An availability window is not a bookable moment — it's a
                    // range. Hand over to the picker, carrying the coach and day
                    // the window already identifies so the visitor isn't asked to
                    // choose again what they just clicked; they only pick the
                    // exact start and length.
                    bookProps(
                      publicHrefLocalized(locale, slug, 'appointments', {
                        activity: selected.activityId,
                        provider: selected.providerId,
                        date: toDayKey(selected.start.toDate()),
                        from: 'site',
                      }),
                      ctx,
                      {
                        kind: 'appointment',
                        activityId: selected.activityId ?? '',
                        providerId: selected.providerId,
                        date: toDayKey(selected.start.toDate()),
                      }
                    )
                  : bookProps(sessionBookHref(ctx, selected), ctx, {
                      kind: 'session',
                      sessionId: selected.id,
                    })
                : null
            }
            // This modal is a hand-rolled `fixed inset-0 z-50` overlay. The
            // booking panel portals to <body> at the same layer, so leaving this
            // backdrop underneath would break Esc and the focus trap — close it
            // FIRST, then open.
            onBookClick={() => setSelected(null)}
            onClose={() => setSelected(null)}
          />
        )}

        <div className="mt-8 text-center">
          <a
            {...bookProps(browseBookHref, ctx, { kind: 'root' })}
            className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.02]"
            style={{ background: palette.accent, color: palette.onAccent }}
          >
            <CalendarDays className="h-4 w-4" />
            Book a session
          </a>
        </div>
      </div>
    </section>
  )
}

// Palette-styled session detail (the calendar/list blocks only fit minimal
// info) — mirrors the kiosk's modal, plus a Book CTA when booking is offered.
function SessionDetailModal({
  s,
  palette,
  bookLinkProps,
  onBookClick,
  onClose,
}: {
  s: SessionEntry
  palette: SitePalette
  /** Ready-made anchor props from `bookProps`; null hides the CTA. */
  bookLinkProps: ReturnType<typeof bookProps> | null
  onBookClick: () => void
  onClose: () => void
}) {
  const start = s.start.toDate()
  const end = s.end?.toDate()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 shadow-xl"
        style={{ background: palette.bg, borderColor: palette.border, color: palette.text }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className="mt-1 h-12 w-1.5 shrink-0 rounded-full"
            style={{ background: s.activityColor || palette.accent }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold">{s.activityName ?? 'Session'}</h3>
            <p className="mt-1 text-sm capitalize" style={{ color: palette.muted }}>
              {start.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 transition-opacity hover:opacity-70"
            style={{ color: palette.muted }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" style={{ color: palette.muted }} />
            <span className="font-medium tabular-nums">
              {fmtTime(start)}
              {end ? ` – ${fmtTime(end)}` : ''}
            </span>
          </div>
          {s.providerName && (
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 shrink-0" style={{ color: palette.muted }} />
              <span>{s.providerName}</span>
            </div>
          )}
          {s.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: palette.muted }} />
              <span>{s.location}</span>
            </div>
          )}
        </div>
        {bookLinkProps && (
          <a
            {...bookLinkProps}
            onClick={(e) => {
              // Dismiss this backdrop before the booking panel opens over it.
              onBookClick()
              bookLinkProps.onClick?.(e)
            }}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.02]"
            style={{ background: palette.accent, color: palette.onAccent }}
          >
            <CalendarPlus className="h-4 w-4" />
            Book
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Contact ──────────────────────────────────────────────────────────────────

function ContactBlock({ section, ctx }: { section: ContactSection; ctx: RenderCtx }) {
  const { palette, preview, socialLinks } = ctx
  const socials = (socialLinks ?? []).filter((s) => s.url)
  const rows: { icon: React.FC<{ className?: string }>; value?: string }[] = [
    { icon: MapPin, value: section.address },
    { icon: Phone, value: section.phone },
    { icon: Mail, value: section.email },
    { icon: Clock, value: section.hours },
  ].filter((r) => r.value)

  return (
    <section id={section.id} className="py-20" style={{ background: palette.bg }}>
      <div className="mx-auto max-w-5xl px-6">
        <Heading text={section.heading ?? 'Get in touch'} palette={palette} />
        <div
          className={`mt-10 grid gap-8 ${section.mapQuery ? '@3xl:grid-cols-2' : 'max-w-md mx-auto'}`}
        >
          <div className="space-y-4">
            {rows.map((r, i) => {
              const Icon = r.icon
              return (
                <div key={i} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${palette.accent}1a`, color: palette.accent }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="whitespace-pre-line text-sm" style={{ color: palette.text }}>
                    {r.value}
                  </p>
                </div>
              )
            })}
            {section.showSocial && socials.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {socials.map((s) => {
                  const Icon = SOCIAL_ICONS[s.platform] ?? Globe
                  return (
                    <a
                      key={s.platform}
                      {...linkProps(s.url, preview, true)}
                      aria-label={s.platform}
                      className="flex h-9 w-9 items-center justify-center rounded-full border transition-opacity hover:opacity-70"
                      style={{ borderColor: palette.border, color: palette.text }}
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  )
                })}
              </div>
            )}
          </div>
          {section.mapQuery && (
            <div
              className="overflow-hidden rounded-2xl border"
              style={{ borderColor: palette.border, minHeight: 240 }}
            >
              <iframe
                title="map"
                className="h-full w-full"
                style={{ minHeight: 240, border: 0 }}
                loading="lazy"
                src={`https://www.google.com/maps?q=${encodeURIComponent(section.mapQuery)}&output=embed`}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// Selected places as simple cards (no map). Published sites carry an embedded
// `places` snapshot; the builder preview resolves the selected ids live.
function PlacesBlock({ section, ctx }: { section: PlacesSection; ctx: RenderCtx }) {
  const { palette, preview, teamId } = ctx
  // PlacesBlock only ever renders inside a team site (org sites have no
  // 'places' section type), so teamId is always defined here.
  const { data: pool = [] } = usePlaces(preview && !section.places ? (teamId ?? null) : null)
  const places =
    section.places ??
    (section.placeIds ?? [])
      .map((id) => pool.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, name: p.name, address: p.address, mapsLink: p.mapsLink }))

  const cols =
    section.columns === 2
      ? '@2xl:grid-cols-2'
      : section.columns === 4
        ? '@2xl:grid-cols-2 @5xl:grid-cols-4'
        : '@2xl:grid-cols-2 @5xl:grid-cols-3'

  return (
    <section id={section.id} className="py-20" style={{ background: palette.bg }}>
      <div className="mx-auto max-w-5xl px-6">
        <Heading text={section.heading ?? 'Find us'} palette={palette} />
        {section.subheading && (
          <p className="mt-3 text-center" style={{ color: palette.muted }}>
            {section.subheading}
          </p>
        )}
        <div className={`mt-10 grid grid-cols-1 gap-5 ${cols}`}>
          {places.length === 0 ? (
            <p className="col-span-full text-center text-sm" style={{ color: palette.muted }}>
              No places selected.
            </p>
          ) : (
            places.map((p) => (
              <div
                key={p.id}
                className="flex flex-col rounded-2xl border p-5"
                style={{ borderColor: palette.border, background: palette.surface }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${palette.accent}1a`, color: palette.accent }}
                  >
                    <MapPin className="h-4 w-4" />
                  </span>
                  <h3 className="text-lg font-semibold" style={{ color: palette.text }}>
                    {p.name}
                  </h3>
                </div>
                {p.address && (
                  <p className="mt-3 text-sm" style={{ color: palette.muted }}>
                    {p.address}
                  </p>
                )}
                {p.mapsLink && (
                  <a
                    {...linkProps(preview ? undefined : p.mapsLink, preview, true)}
                    className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-semibold transition-opacity hover:opacity-70"
                    style={{ color: palette.accent }}
                  >
                    Open in maps
                    <ArrowRight className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

// ─── dispatcher ───────────────────────────────────────────────────────────────

export function SectionBlock({
  section,
  ctx,
}: {
  section: WebsiteSection | OrgSiteSection
  ctx: RenderCtx
}) {
  switch (section.type) {
    case 'hero':
      return <HeroBlock section={section} ctx={ctx} />
    case 'content':
    case 'about':
      return <ContentBlock section={section} ctx={ctx} />
    case 'gallery':
      return <GalleryBlock section={section} ctx={ctx} />
    case 'activities':
      return <ActivitiesBlock section={section} ctx={ctx} />
    case 'pricing':
      return <PricingBlock section={section} ctx={ctx} />
    case 'schedule':
      return <ScheduleBlock section={section} ctx={ctx} />
    case 'contact':
      return <ContactBlock section={section} ctx={ctx} />
    case 'places':
      return <PlacesBlock section={section} ctx={ctx} />
    case 'clubs':
      return <ClubsBlock section={section} ctx={ctx} />
    case 'locations':
      return <LocationsBlock section={section} ctx={ctx} />
    case 'coaches':
      return <CoachesBlock section={section} ctx={ctx} />
    default:
      return null
  }
}

/** Nav-menu label for a section: an explicit `menuLabel` wins, otherwise fall
 *  back to the section heading (or a type default). Keeps the menu terse while
 *  the on-page title can stay long. */
export function sectionNavLabel(section: WebsiteSection | OrgSiteSection): string {
  const menuLabel = (section as { menuLabel?: string }).menuLabel?.trim()
  if (menuLabel) return menuLabel
  switch (section.type) {
    case 'content':
    case 'about':
      return section.heading || 'Content'
    case 'gallery':
      return section.heading || 'Gallery'
    case 'activities':
      return section.heading || 'Activities'
    case 'pricing':
      return section.heading || 'Pricing'
    case 'schedule':
      return section.heading || 'Schedule'
    case 'contact':
      return section.heading || 'Contact'
    case 'places':
      return section.heading || 'Locations'
    case 'clubs':
      return section.heading || 'Clubs'
    case 'locations':
      return section.heading || 'Locations'
    case 'coaches':
      return section.heading || 'Coaches'
    default:
      return ''
  }
}
