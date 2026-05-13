'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  collectionGroup, collection, query, where, orderBy,
  limit, getDocs, Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { COACH_SLOTS_COLLECTION } from '@lineup/shared'
import type { CoachSlot } from '@lineup/shared'
import { CalendarClock, MapPin, Video, Clock, User, Check } from 'lucide-react'

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate(): Date }): string {
  return ts.toDate().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTime(ts: { toDate(): Date }): string {
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ─── booking form schema ──────────────────────────────────────────────────────

const bookingSchema = z.object({
  firstname: z.string().min(1, 'Required').max(60),
  lastname: z.string().min(1, 'Required').max(60),
  email: z.string().email('Enter a valid email'),
  phone: z.string().max(30).optional(),
  notes: z.string().max(500).optional(),
})
type BookingFormValues = z.infer<typeof bookingSchema>

// ─── slot card ────────────────────────────────────────────────────────────────

function SlotCard({
  slot,
  teamId,
  onBooked,
}: {
  slot: CoachSlot & { id: string }
  teamId: string
  onBooked: (details: { firstname: string; email: string; start: Date; title: string }) => void
}) {
  const t = useTranslations('CoachingPortal')
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
  })

  async function onSubmit(data: BookingFormValues) {
    setError(null)
    try {
      const fn = httpsCallable(functions, 'bookCoachSlot')
      await fn({
        teamId,
        slotId: slot.id,
        contact: {
          firstname: data.firstname,
          lastname: data.lastname,
          email: data.email,
          phone: data.phone || undefined,
          notes: data.notes || undefined,
        },
      })
      onBooked({ firstname: data.firstname, email: data.email, start: slot.start.toDate(), title: slot.title })
    } catch (err) {
      const e = err as { code?: string; message?: string }
      if (e.code === 'already-exists') setError(t('errorAlreadyBooked'))
      else if (e.code === 'failed-precondition') setError(t('errorSlotUnavailable'))
      else setError(t('errorGeneric'))
    }
  }

  const isFull = slot.status === 'full'

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{slot.title}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{formatDate(slot.start)}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />{formatTime(slot.start)} – {formatTime(slot.end)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 opacity-0" />{formatDuration(slot.duration_minutes)}
            </span>
            {slot.coachName && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />{slot.coachName}
              </span>
            )}
            {slot.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />{slot.location}
              </span>
            )}
            {slot.onlineUrl && (
              <span className="flex items-center gap-1">
                <Video className="h-3 w-3" />{t('onlineSession')}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {isFull ? (
            <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">{t('full')}</span>
          ) : (
            <Button size="sm" onClick={() => setExpanded((v) => !v)} variant={expanded ? 'outline' : 'default'}>
              {expanded ? t('hideForm') : t('book')}
            </Button>
          )}
        </div>
      </div>

      {expanded && !isFull && (
        <div className="border-t bg-muted/30 px-4 pb-4 pt-3">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`fn-${slot.id}`} className="text-xs">{t('fieldFirstname')}</Label>
                <Input id={`fn-${slot.id}`} {...register('firstname')} />
                {errors.firstname && <p className="text-destructive text-xs">{errors.firstname.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`ln-${slot.id}`} className="text-xs">{t('fieldLastname')}</Label>
                <Input id={`ln-${slot.id}`} {...register('lastname')} />
                {errors.lastname && <p className="text-destructive text-xs">{errors.lastname.message}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`em-${slot.id}`} className="text-xs">{t('fieldEmail')}</Label>
              <Input id={`em-${slot.id}`} type="email" {...register('email')} />
              {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ph-${slot.id}`} className="text-xs">{t('fieldPhone')}</Label>
              <Input id={`ph-${slot.id}`} type="tel" {...register('phone')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`nt-${slot.id}`} className="text-xs">{t('fieldNotes')}</Label>
              <Input id={`nt-${slot.id}`} {...register('notes')} />
            </div>
            {error && (
              <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? t('submitting') : t('submit')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// ─── confirmation screen ──────────────────────────────────────────────────────

function ConfirmationScreen({ firstname, email }: { firstname: string; email: string }) {
  const t = useTranslations('CoachingPortal')
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
          <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-xl font-bold">{t('confirmedTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('confirmedMessage', { email })}
        </p>
      </div>
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export default function CoachingPortal({ slug }: { slug: string }) {
  const t = useTranslations('CoachingPortal')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')
  const [slots, setSlots] = useState<(CoachSlot & { id: string })[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmed, setConfirmed] = useState<{ firstname: string; email: string } | null>(null)

  useEffect(() => {
    async function load() {
      // 1. Resolve team by slug
      const teamSnap = await getDocs(
        query(collectionGroup(db, 'public_profile'), where('slug', '==', slug), where('type', '==', 'team'), limit(1))
      )
      if (teamSnap.empty) { setLoading(false); return }

      const resolvedTeamId = teamSnap.docs[0].ref.parent.parent!.id
      setTeamId(resolvedTeamId)
      setTeamName(teamSnap.docs[0].data().name || '')

      // 2. Load open slots
      const slotsSnap = await getDocs(
        query(
          collection(db, COACH_SLOTS_COLLECTION),
          where('teamId', '==', resolvedTeamId),
          where('status', 'in', ['open', 'full']),
          where('start', '>=', Timestamp.now()),
          orderBy('start', 'asc'),
          limit(30),
        )
      )
      setSlots(slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as CoachSlot & { id: string }))
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [slug])

  if (confirmed) {
    return <ConfirmationScreen firstname={confirmed.firstname} email={confirmed.email} />
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          {teamName && <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{teamName}</p>}
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        )}

        {/* Not found */}
        {!loading && !teamId && (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('teamNotFound')}</p>
          </div>
        )}

        {/* No slots */}
        {!loading && teamId && slots?.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t('noSlots')}</p>
            <p className="text-sm mt-1">{t('noSlotsHint')}</p>
          </div>
        )}

        {/* Slot list */}
        {teamId && slots && slots.length > 0 && (
          <div className="space-y-3">
            {slots.map((slot) => (
              <SlotCard
                key={slot.id}
                slot={slot}
                teamId={teamId}
                onBooked={({ firstname, email }) => setConfirmed({ firstname, email })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
