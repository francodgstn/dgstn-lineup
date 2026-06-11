'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useOrg } from '@/contexts/OrgContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, CalendarDays, MapPin, Users, Check, X } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { EVENTS_COLLECTION, CHECKINS_COLLECTION } from '@linyup/shared'
import type { Event, EventCheckin } from '@linyup/shared'
import type { Route } from 'next'

interface Team { id: string; name: string }

function formatDate(ts: { toDate(): Date } | null | undefined) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function useOrgEvent(eventId: string) {
  return useQuery<Event | null>({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, EVENTS_COLLECTION, eventId))
      return snap.exists() ? ({ ...snap.data(), id: snap.id } as Event) : null
    },
  })
}

function useEventCheckins(eventId: string) {
  return useQuery<EventCheckin[]>({
    queryKey: ['event-checkins', eventId],
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, CHECKINS_COLLECTION),
        where('event.id', '==', eventId),
      ))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as EventCheckin)
    },
  })
}

function useOrgTeams(orgId: string) {
  return useQuery<Team[]>({
    queryKey: ['org-teams-list', orgId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, 'teams'),
        where('org_id', '==', orgId),
      ))
      return snap.docs.map((d) => ({ id: d.id, name: d.data().name as string }))
    },
  })
}

function initials(c: { contact: { firstname: string; lastname: string } }) {
  return `${c.contact.firstname?.[0] ?? ''}${c.contact.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

export default function OrgEventDetailPage() {
  const { orgId, id: eventId } = useParams<{ orgId: string; id: string }>()
  const { isAdmin } = useOrg()
  const qc = useQueryClient()

  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [toggling, setToggling] = useState<string | null>(null)

  const eventQ = useOrgEvent(eventId)
  const checkinsQ = useEventCheckins(eventId)
  const teamsQ = useOrgTeams(orgId)

  const teamMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of teamsQ.data ?? []) m.set(t.id, t.name)
    return m
  }, [teamsQ.data])

  const visibleCheckins = useMemo(() => {
    const all = checkinsQ.data ?? []
    return teamFilter === 'all' ? all : all.filter((c) => c.teamId === teamFilter)
  }, [checkinsQ.data, teamFilter])

  const confirmedCount = visibleCheckins.filter((c) => c.is_completed).length

  async function toggleConfirm(checkin: EventCheckin) {
    setToggling(checkin.id)
    try {
      await updateDoc(doc(db, CHECKINS_COLLECTION, checkin.id), {
        is_completed: !checkin.is_completed,
        updated_at: serverTimestamp(),
      })
      qc.invalidateQueries({ queryKey: ['event-checkins', eventId] })
    } finally {
      setToggling(null)
    }
  }

  const event = eventQ.data

  return (
    <div className="space-y-5">
      {/* Back */}
      <Link
        href={`/org/${orgId}/events` as Route}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Organization events
      </Link>

      {/* Event header */}
      {eventQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !event ? (
        <p className="text-muted-foreground text-sm">Event not found.</p>
      ) : (
        <div className="rounded-lg border p-4 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{event.title}</h2>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDate(event.start as { toDate(): Date } | null | undefined)}
                  {' — '}
                  {formatDate(event.end as { toDate(): Date } | null | undefined)}
                </span>
                {event.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />{event.location}
                  </span>
                )}
              </div>
            </div>
            <Badge variant="secondary" className="capitalize shrink-0">{event.type}</Badge>
          </div>
          {event.description && (
            <p className="text-sm text-muted-foreground pt-1">{event.description}</p>
          )}
        </div>
      )}

      {/* Checkins section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              Check-ins
              {checkinsQ.data && (
                <span className="ml-1.5 text-muted-foreground font-normal">
                  {confirmedCount} confirmed / {visibleCheckins.length} total
                </span>
              )}
            </span>
          </div>

          {/* Team filter */}
          {teamsQ.data && teamsQ.data.length > 1 && (
            <Select value={teamFilter} onValueChange={(v) => setTeamFilter(v ?? 'all')}>
              <SelectTrigger className="w-48 h-8 text-sm">
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teamsQ.data.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="rounded-md border">
          {checkinsQ.isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : visibleCheckins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <Users className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No check-ins yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Participant</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Team</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5 hidden md:table-cell">Checked in</th>
                  <th className="text-right font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  {isAdmin && <th className="px-4 py-2.5 w-12" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleCheckins.map((checkin) => (
                  <tr key={checkin.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                          {initials(checkin)}
                        </div>
                        <span className="font-medium">
                          {checkin.contact.firstname} {checkin.contact.lastname}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {teamMap.get(checkin.teamId) ?? checkin.teamId}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">
                      {checkin.created_at
                        ? new Date((checkin.created_at as { toDate(): Date }).toDate()).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant={checkin.is_completed ? 'default' : 'secondary'}>
                        {checkin.is_completed ? 'Confirmed' : 'Pending'}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={toggling === checkin.id}
                          onClick={() => toggleConfirm(checkin)}
                          title={checkin.is_completed ? 'Unconfirm' : 'Confirm'}
                        >
                          {checkin.is_completed
                            ? <X className="h-3.5 w-3.5 text-muted-foreground" />
                            : <Check className="h-3.5 w-3.5 text-green-600" />}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
