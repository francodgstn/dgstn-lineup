'use client'

import { useEffect, useState, type CSSProperties } from 'react'
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
import { db } from '@/lib/firebase'
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
import { compareActivities } from '@linyup/shared'
import type { SitePalette } from './theme'
import { ctaHref } from './theme'
import { usePlaces } from '@/hooks/usePlaces'
import { ClubsBlock, LocationsBlock, CoachesBlock } from './orgSections'
import { WeeklyCalendar } from '@/components/schedule/WeeklyCalendar'

export interface RenderCtx {
  palette: SitePalette
  slug: string
  /** Team sites only (undefined for org sites — use `orgId`/`orgTeams` instead). */
  teamId?: string
  /** Org sites only. */
  orgId?: string
  /** Org sites only — the embedded member-team snapshot, used by the clubs/
   *  locations/coaches aggregate blocks to fetch each club's live public_profile. */
  orgTeams?: OrgSiteTeamRef[]
  preview: boolean
  socialLinks?: SocialLink[]
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

// ─── Hero ───────────────────────────────────────────────────────────────────

function HeroBlock({ section, ctx }: { section: HeroSection; ctx: RenderCtx }) {
  const { palette, slug, preview } = ctx
  const href = ctaHref(section.cta, slug)
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
              {...linkProps(href, preview, section.cta.action === 'url')}
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
}

function ActivitiesBlock({ section, ctx }: { section: ActivitiesSection; ctx: RenderCtx }) {
  const { palette, slug, teamId, preview } = ctx
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('teamId', '==', teamId),
      where('type', '==', 'activity')
    )
    getDocs(q)
      .then((snap) => {
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
            }
          })
          .filter((a) => a.name)
          .sort(compareActivities)
        setActivities(list)
      })
      .catch(() => {
        if (alive) setActivities([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [teamId])

  const cols =
    section.columns === 2
      ? '@2xl:grid-cols-2'
      : section.columns === 4
        ? '@2xl:grid-cols-2 @5xl:grid-cols-4'
        : '@2xl:grid-cols-2 @5xl:grid-cols-3'

  return (
    <section id={section.id} className="py-20" style={{ background: palette.bg }}>
      <div className="mx-auto max-w-5xl px-6">
        <Heading text={section.heading ?? 'What we offer'} palette={palette} />
        {section.subheading && (
          <p className="mt-3 text-center" style={{ color: palette.muted }}>
            {section.subheading}
          </p>
        )}
        <div className={`mt-10 grid grid-cols-1 gap-5 ${cols}`}>
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
              const href = !section.showBooking
                ? undefined
                : a.activityType === 'appointment'
                  ? `/public/${slug}/appointments`
                  : a.slug
                    ? `/public/${slug}/booking/${a.slug}`
                    : undefined
              return (
                <div
                  key={a.id}
                  className="flex flex-col overflow-hidden rounded-2xl border"
                  style={{ borderColor: palette.border, background: palette.surface }}
                >
                  <div
                    className="relative aspect-[4/3] w-full"
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
                    {a.isFreeTrial && (
                      <span
                        className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold shadow"
                        style={{ background: palette.accent, color: palette.onAccent }}
                      >
                        Free trial
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold" style={{ color: palette.text }}>
                        {a.name}
                      </h3>
                      {a.level && a.level !== 'all' && (
                        <span
                          className="rounded-full border px-2 py-0.5 text-xs capitalize"
                          style={{ borderColor: palette.border, color: palette.muted }}
                        >
                          {a.level}
                        </span>
                      )}
                    </div>
                    {a.description && (
                      <p className="mt-2 flex-1 text-sm" style={{ color: palette.muted }}>
                        {a.description}
                      </p>
                    )}
                    {href && (
                      <a
                        {...linkProps(preview ? undefined : href, preview)}
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
  const { palette, slug, teamId, preview } = ctx
  const [plans, setPlans] = useState<PlanEntry[]>([])
  const [currency, setCurrency] = useState('CHF')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // PricingBlock only ever renders inside a team site (org sites have no
    // 'pricing' section type), so teamId is always defined here.
    getDoc(doc(db, 'teams', teamId!, 'public_profile', teamId!))
      .then((snap) => {
        if (!alive) return
        const list = (snap.data()?.aggregator_subscription_types ?? []) as PlanEntry[]
        setPlans(Array.isArray(list) ? list : [])
        setCurrency((snap.data()?.default_currency as string | undefined) ?? 'CHF')
      })
      .catch(() => {
        if (alive) setPlans([])
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
                    {p.prices.map((pr, i) => (
                      <div key={i} className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold" style={{ color: palette.text }}>
                          {formatCurrency(pr.amount, currency)}
                        </span>
                        <span className="text-sm" style={{ color: palette.muted }}>
                          {RECURRENCE_SUFFIX[pr.recurrence] ?? ''}
                          {pr.label ? ` · ${pr.label}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {p.description && (
                  <p className="mt-2 flex-1 text-sm" style={{ color: palette.muted }}>
                    {p.description}
                  </p>
                )}
                <a
                  {...linkProps(preview ? undefined : `/public/${slug}/shop?type=${p.id}`, preview)}
                  className="mt-5 inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.02]"
                  style={{ background: palette.accent, color: palette.onAccent }}
                >
                  {section.ctaLabel ?? 'Join now'}
                </a>
              </div>
            ))
          )}
        </div>
        {!loading && plans.length > 0 && (
          <div className="mt-8 text-center">
            <a
              {...linkProps(preview ? undefined : `/public/${slug}/shop`, preview)}
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

interface SessionEntry {
  id: string
  /** Public-mirror kind: 'session' (group class) or 'appointment_session'. */
  type?: string
  activityName?: string
  activityColor?: string
  activityId?: string
  start: Timestamp
  end?: Timestamp
  location?: string
  providerName?: string
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
  const { palette, slug, teamId, preview } = ctx
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [loading, setLoading] = useState(true)
  // Studio sets the default view; visitors can switch with the toggle below.
  const [view, setView] = useState<'list' | 'calendar'>(section.displayMode ?? 'calendar')
  const [selected, setSelected] = useState<SessionEntry | null>(null)
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const windowEnd = new Date()
    windowEnd.setDate(windowEnd.getDate() + (section.windowDays ?? 7))
    // Group classes AND appointment slots — private lessons are part of the weekly
    // schedule too. `in` runs on the same (teamId,type,allowBooking,start) index.
    // The lower bound is Monday of the CURRENT week (not "now"): the calendar
    // doubles as a timetable, showing this week's already-run sessions muted.
    const q = query(
      collectionGroup(db, 'public_profile'),
      where('teamId', '==', teamId),
      where('type', 'in', ['session', 'appointment_session']),
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
      .catch(() => {
        if (alive) setSessions([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [teamId, section.windowDays, section.activityId])

  const bookHref = preview ? undefined : `/public/${slug}/booking`
  // Appointment slots book through the appointments page, not the class-booking flow.
  const hrefFor = (s: SessionEntry) =>
    preview ? undefined : s.type === 'appointment_session' ? `/public/${slug}/appointments` : bookHref

  // Daily list covers today onward (today's finished sessions render muted);
  // the calendar additionally shows the current week's past days as a timetable.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const listDays = groupByDay(sessions.filter((s) => s.start.toDate() >= startOfToday))
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
                sessions={sessions}
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
            preview={preview}
            bookHref={section.showBooking && !isPastSession(selected) ? hrefFor(selected) : undefined}
            onClose={() => setSelected(null)}
          />
        )}

        <div className="mt-8 text-center">
          <a
            {...linkProps(bookHref, preview)}
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
  preview,
  bookHref,
  onClose,
}: {
  s: SessionEntry
  palette: SitePalette
  preview: boolean
  bookHref?: string
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
        {bookHref && (
          <a
            {...linkProps(bookHref, preview)}
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
