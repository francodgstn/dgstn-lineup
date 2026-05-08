'use client'

import { useQuery } from '@tanstack/react-query'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  collectionGroup,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Users,
  CalendarDays,
  TrendingUp,
  BookOpen,
  Plus,
  UserPlus,
  ArrowRight,
  Clock,
} from 'lucide-react'
import Link from 'next/link'
import type { Route } from 'next'
import type { Contact, Session, Booking } from '@lineup/shared'
import { CONTACTS_COLLECTION, SESSIONS_COLLECTION } from '@lineup/shared'

// ─── helpers ─────────────────────────────────────────────────────────────────

function todayStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function weekStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)) // Monday
  return d
}

function formatTime(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return ''
  const d = ts.toDate()
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// ─── data hooks ──────────────────────────────────────────────────────────────

function useContacts(teamId: string | null) {
  return useQuery({
    queryKey: ['contacts', teamId],
    enabled: !!teamId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contact))
    },
  })
}

function useUpcomingSessions(teamId: string | null) {
  return useQuery({
    queryKey: ['sessions', 'upcoming', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const q = query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', teamId),
        where('start', '>=', Timestamp.fromDate(todayStart())),
        orderBy('start', 'asc'),
        limit(8),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Session))
    },
  })
}

function useRecentBookings(teamId: string | null) {
  return useQuery({
    queryKey: ['bookings', 'recent', teamId],
    enabled: !!teamId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const q = query(
        collectionGroup(db, 'bookings'),
        where('teamId', '==', teamId),
        orderBy('joinedAt', 'desc'),
        limit(5),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking))
    },
  })
}

// ─── stat card ───────────────────────────────────────────────────────────────

interface StatCardProps {
  title: string
  value: number | null | undefined
  subtitle: string
  icon: React.ElementType
  loading?: boolean
  href?: string
}

function StatCard({ title, value, subtitle, icon: Icon, loading, href }: StatCardProps) {
  const inner = (
    <Card className={href ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-16 mb-1" />
        ) : (
          <p className="text-3xl font-black leading-none">{value ?? '—'}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  )

  return href ? <Link href={href as Route}>{inner}</Link> : inner
}

// ─── section heading ──────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
      <Separator className="mt-1.5" />
    </div>
  )
}

// ─── today's sessions ─────────────────────────────────────────────────────────

function TodaysSessions({ teamId }: { teamId: string | null }) {
  const { data: sessions, isLoading } = useUpcomingSessions(teamId)

  const todaySessions = sessions?.filter((s) => {
    if (!s.start) return false
    const d = (s.start as { toDate(): Date }).toDate()
    return d.toDateString() === new Date().toDateString()
  }) ?? []

  const futureSessions = sessions?.filter((s) => {
    if (!s.start) return false
    const d = (s.start as { toDate(): Date }).toDate()
    return d.toDateString() !== new Date().toDateString()
  }) ?? []

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Upcoming sessions</CardTitle>
          <Link href="/sessions" className="text-xs text-primary hover:underline flex items-center gap-0.5">
            All sessions <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : sessions?.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No upcoming sessions scheduled
          </div>
        ) : (
          <div className="space-y-1">
            {todaySessions.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground px-1 pb-1">Today</p>
                {todaySessions.map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </>
            )}
            {futureSessions.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground px-1 pb-1 pt-3">Upcoming</p>
                {futureSessions.map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SessionRow({ session }: { session: Session }) {
  const bookings = (session as { portal_bookings_count?: number }).portal_bookings_count ?? 0
  return (
    <Link href="/sessions" className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-muted/50 transition-colors group">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/8 flex flex-col items-center justify-center">
        <Clock className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {session.activityName ?? 'Session'}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDate(session.start as Parameters<typeof formatDate>[0])}
          {' · '}
          {formatTime(session.start as Parameters<typeof formatTime>[0])}
          {session.location ? ` · ${session.location}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {bookings > 0 && (
          <Badge variant="secondary" className="text-xs">
            {bookings} booking{bookings !== 1 ? 's' : ''}
          </Badge>
        )}
        {session.participants_count != null && session.participants_count > 0 && (
          <span className="text-xs text-muted-foreground">{session.participants_count} attended</span>
        )}
      </div>
    </Link>
  )
}

// ─── recent bookings ─────────────────────────────────────────────────────────

function RecentBookings({ teamId }: { teamId: string | null }) {
  const { data: bookings, isLoading } = useRecentBookings(teamId)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent bookings</CardTitle>
          <Link href="/bookings" className="text-xs text-primary hover:underline flex items-center gap-0.5">
            All <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : !bookings?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No recent bookings</p>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {(b.firstname?.[0] ?? '?').toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {b.firstname} {b.lastname}
                  </p>
                  <p className="text-xs text-muted-foreground">{b.email}</p>
                </div>
                {b.is_new_contact && (
                  <Badge variant="outline" className="text-xs flex-shrink-0">Trial</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── quick actions ────────────────────────────────────────────────────────────

function QuickActions({ teamSlug }: { teamSlug?: string }) {
  const actions: { label: string; icon: React.ElementType; href: Route }[] = [
    { label: 'New contact', icon: UserPlus, href: '/contacts' },
    { label: 'New session', icon: Plus, href: '/sessions' },
    {
      label: 'View portal',
      icon: BookOpen,
      href: (teamSlug ? `/portal/${teamSlug}` : '/team/portal') as Route,
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Quick actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {actions.map((a) => (
            <Link
              key={String(a.href)}
              href={a.href}
              className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <a.icon className="h-4 w-4 text-muted-foreground" />
              {a.label}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentTeamId, profile } = useAuth()

  const { data: contacts, isLoading: contactsLoading } = useContacts(currentTeamId)
  const { data: sessions, isLoading: sessionsLoading } = useUpcomingSessions(currentTeamId)

  // Derived counts from contacts
  const activeMembers = contacts?.filter((c) => c.membership_status === 'active').length ?? null
  const engagedThisWeek = contacts?.filter((c) => {
    if (!c.last_session_at) return false
    return (c.last_session_at as { toDate(): Date }).toDate() >= weekStart()
  }).length ?? null

  // Upcoming bookings count
  const upcomingBookingsCount = sessions?.reduce(
    (sum, s) => sum + ((s as { portal_bookings_count?: number }).portal_bookings_count ?? 0),
    0,
  ) ?? null

  const upcomingSessionsCount = sessions?.length ?? null

  const teamSlug = (profile as { slug?: string } | null)?.slug

  const statsLoading = contactsLoading || sessionsLoading

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* ── KPI stats ── */}
      <SectionHeading>Highlights</SectionHeading>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active members"
          value={activeMembers}
          subtitle="active membership status"
          icon={Users}
          loading={statsLoading}
          href="/contacts"
        />
        <StatCard
          title="Engaged this week"
          value={engagedThisWeek}
          subtitle="attended ≥1 session this week"
          icon={TrendingUp}
          loading={statsLoading}
          href="/contacts"
        />
        <StatCard
          title="Upcoming bookings"
          value={upcomingBookingsCount}
          subtitle="trial bookings ahead"
          icon={BookOpen}
          loading={sessionsLoading}
          href="/bookings"
        />
        <StatCard
          title="Sessions scheduled"
          value={upcomingSessionsCount}
          subtitle="from today onwards"
          icon={CalendarDays}
          loading={sessionsLoading}
          href="/sessions"
        />
      </div>

      {/* ── Main content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sessions — left, wider */}
        <div className="lg:col-span-7">
          <TodaysSessions teamId={currentTeamId} />
        </div>

        {/* Sidebar — right */}
        <div className="lg:col-span-5 space-y-4">
          <QuickActions teamSlug={teamSlug} />
          <RecentBookings teamId={currentTeamId} />
        </div>
      </div>
    </div>
  )
}
