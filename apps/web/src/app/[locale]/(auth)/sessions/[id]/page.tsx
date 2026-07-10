'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  updateDoc, deleteDoc, setDoc, increment, serverTimestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouter as useI18nRouter } from '@/i18n/navigation'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Pencil, Trash2, UserPlus,
  MapPin, Clock, Users, QrCode, BookOpen, CheckCircle2, UserX,
  ExternalLink, X, Check, Ban, AlertTriangle,
} from 'lucide-react'
import {
  SESSIONS_COLLECTION, ACTIVITIES_COLLECTION, CONTACTS_COLLECTION,
  PARTICIPANTS_SUBCOLLECTION, resolveActivityAccessRule,
  activityRequiresSubscription, contactHoldsCoveringSubscription,
} from '@linyup/shared'
import type { Session, Booking, Contact, Activity } from '@linyup/shared'
import { SessionFormDialog } from '@/components/sessions/SessionFormDialog'
import { SessionDeleteDialog } from '@/components/sessions/SessionDeleteDialog'

// ─── constants ────────────────────────────────────────────────────────────────

const BOOKINGS_SUB = 'bookings'

// ─── activity color palette (matches SessionsCalendar) ────────────────────────

const PALETTE = [
  { bg: '#EDE9FE', text: '#5B21B6', accent: '#7C3AED' },
  { bg: '#FCE7F3', text: '#9D174D', accent: '#EC4899' },
  { bg: '#DBEAFE', text: '#1D4ED8', accent: '#3B82F6' },
  { bg: '#D1FAE5', text: '#065F46', accent: '#10B981' },
  { bg: '#FEF3C7', text: '#92400E', accent: '#F59E0B' },
  { bg: '#FFE4E6', text: '#9F1239', accent: '#F43F5E' },
  { bg: '#E0F2FE', text: '#075985', accent: '#0EA5E9' },
  { bg: '#F0FDF4', text: '#14532D', accent: '#22C55E' },
]
function activityPalette(activityId?: string | null, customColor?: string | null) {
  if (customColor) return { bg: `${customColor}18`, text: customColor, accent: customColor }
  if (!activityId) return PALETTE[0]
  let h = 0
  for (let i = 0; i < activityId.length; i++) h = (h * 31 + activityId.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts?: { toDate(): Date } | null) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function formatTime(ts?: { toDate(): Date } | null) {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
// ─── participant type (Firestore doc shape) ───────────────────────────────────

interface ParticipantDoc {
  id: string
  contact?: string
  firstname: string
  lastname: string
  fullname?: string
  avatar_url?: string | null
  checkedInAt?: { toDate(): Date }
  confirmedFromBooking?: boolean
}

// ─── QR scanner hook ──────────────────────────────────────────────────────────

function useQrScanner(onScan: (text: string) => void) {
  const t = useTranslations('SessionDetail')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const detectorRef = useRef<{ detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } | null>(null)

  const start = useCallback(async () => {
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!('BarcodeDetector' in window)) { setError(t('qrScanningUnsupported')); return }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detectorRef.current = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      setActive(true)
    } catch {
      setError(t('cameraAccessDenied'))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
  }, [])

  // Scan loop — runs when active
  useEffect(() => {
    if (!active || !detectorRef.current) return
    let stopped = false
    const onScanRef = onScan
    const loop = async () => {
      if (stopped || !videoRef.current || !detectorRef.current) return
      try {
        if (videoRef.current.readyState >= 2) {
          const barcodes = await detectorRef.current.detect(videoRef.current)
          if (barcodes.length > 0) onScanRef(barcodes[0].rawValue)
        }
      } catch { /* ignore frame errors */ }
      rafRef.current = requestAnimationFrame(loop)
    }
    loop()
    return () => { stopped = true; cancelAnimationFrame(rafRef.current) }
  }, [active, onScan])

  useEffect(() => () => stop(), [stop])

  return { videoRef, active, error, start, stop }
}

// ─── add participants dialog ──────────────────────────────────────────────────

function AddParticipantsDialog({
  open, onOpenChange, teamId, sessionId, existingIds, onAdded, requiredSubscriptionTypeIds,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  sessionId: string
  existingIds: Set<string>
  onAdded: () => void
  /** Subscription-type ids the session's activity demands; null/empty = not gated. */
  requiredSubscriptionTypeIds: string[] | null
}) {
  const t = useTranslations('SessionDetail')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  // Contact awaiting the "no valid subscription — add anyway?" confirmation.
  const [confirming, setConfirming] = useState<Contact | null>(null)

  const isCovered = (c: Contact) =>
    !requiredSubscriptionTypeIds?.length ||
    contactHoldsCoveringSubscription(c, requiredSubscriptionTypeIds)

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ['contacts', 'active', teamId],
    enabled: open,
    queryFn: async () => {
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', teamId),
        where('deleted_at', '==', null),
        where('archived_at', '==', null),
        orderBy('lastname'),
        orderBy('firstname'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
    },
  })

  const filtered = contacts.filter((c) => {
    if (existingIds.has(c.id)) return false
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return (
      c.firstname?.toLowerCase().includes(s) ||
      c.lastname?.toLowerCase().includes(s) ||
      c.email?.toLowerCase().includes(s)
    )
  })

  const add = async (contact: Contact, { force = false } = {}) => {
    if (!force && !isCovered(contact)) {
      setConfirming(contact)
      return
    }
    setConfirming(null)
    setAdding(contact.id)
    try {
      const participantRef = doc(db, SESSIONS_COLLECTION, sessionId, PARTICIPANTS_SUBCOLLECTION, contact.id)
      await setDoc(participantRef, {
        contact: contact.id,
        session: sessionId,
        firstname: contact.firstname,
        lastname: contact.lastname,
        fullname: `${contact.lastname ?? ''} ${contact.firstname ?? ''}`.trim(),
        avatar_url: contact.avatar_url ?? null,
        checkedInAt: serverTimestamp(),
        checkedInBy: 'manual',
      })
      await updateDoc(doc(db, SESSIONS_COLLECTION, sessionId), { participants_count: increment(1) })
      onAdded()
    } finally {
      setAdding(null)
    }
  }

  function initials(c: Contact) {
    return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
  }

  useEffect(() => {
    if (!open) setConfirming(null)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="text-base">{t('addContactToSession')}</DialogTitle>
        </DialogHeader>
        <div className="px-3 pt-3 pb-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchContactsPlaceholder')}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {confirming ? (
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900">{t('noSubConfirmTitle')}</p>
                <p className="text-xs text-amber-800">
                  {t('noSubConfirmBody', { name: `${confirming.firstname} ${confirming.lastname}` })}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
              >
                {t('noSubConfirmCancel')}
              </button>
              <button
                onClick={() => add(confirming, { force: true })}
                disabled={adding === confirming.id}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {t('noSubConfirmAddAnyway')}
              </button>
            </div>
          </div>
        ) : (
        <div className="overflow-y-auto max-h-80">
          {isLoading && (
            <div className="px-4 py-3 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('noContactsFound')}</p>
          )}
          {!isLoading && filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => add(c)}
              disabled={adding === c.id}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left disabled:opacity-50"
            >
              <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                {initials(c)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.firstname} {c.lastname}</p>
                {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
              </div>
              {!isCovered(c) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 flex-shrink-0">
                  <AlertTriangle className="h-3 w-3" />
                  {t('noSubBadge')}
                </span>
              )}
              {adding === c.id && <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
            </button>
          ))}
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon, label, count, color }: { icon: React.ReactNode; label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: `${color}20`, color }}>
        {icon}
      </div>
      <span className="font-semibold text-sm">{label}</span>
      <span className="h-5 min-w-5 px-1.5 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: `${color}20`, color }}>
        {count}
      </span>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SessionDetailPage() {
  const t = useTranslations('SessionDetail')
  const params = useParams()
  const sessionId = params.id as string
  const router = useRouter()
  const i18nRouter = useI18nRouter()
  const { currentTeamId, user } = useAuth()
  const qc = useQueryClient()

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  // QR scanner state — kept for when scanner is re-enabled; prefixed with _ to suppress unused-var lint
  const [scanning, _setScanning] = useState(false)
  const [_scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // ── data fetching ────────────────────────────────────────────────────────────

  const sessionQ = useQuery<Session | null>({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, SESSIONS_COLLECTION, sessionId))
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() } as Session
    },
  })

  const participantsQ = useQuery<ParticipantDoc[]>({
    queryKey: ['session-participants', sessionId],
    queryFn: async () => {
      const snap = await getDocs(collection(db, SESSIONS_COLLECTION, sessionId, PARTICIPANTS_SUBCOLLECTION))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ParticipantDoc)
    },
  })

  const bookingsQ = useQuery<Booking[]>({
    queryKey: ['session-bookings', sessionId],
    queryFn: async () => {
      const snap = await getDocs(collection(db, SESSIONS_COLLECTION, sessionId, BOOKINGS_SUB))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Booking)
    },
  })

  const activitiesQ = useQuery<Activity[]>({
    queryKey: ['activities', currentTeamId],
    enabled: !!currentTeamId,
    queryFn: async () => {
      if (!currentTeamId) return []
      const q = query(collection(db, ACTIVITIES_COLLECTION), where('teamId', '==', currentTeamId))
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Activity)
    },
  })

  // Adjacent sessions for prev/next navigation
  const prevQ = useQuery<Session | null>({
    queryKey: ['session-prev', sessionId, currentTeamId],
    enabled: !!sessionQ.data?.start && !!currentTeamId,
    queryFn: async () => {
      if (!sessionQ.data?.start || !currentTeamId) return null
      const q = query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', currentTeamId),
        where('start', '<', sessionQ.data.start),
        orderBy('start', 'desc'),
        limit(1),
      )
      const snap = await getDocs(q)
      if (snap.empty) return null
      return { id: snap.docs[0].id, ...snap.docs[0].data() } as Session
    },
  })

  const nextQ = useQuery<Session | null>({
    queryKey: ['session-next', sessionId, currentTeamId],
    enabled: !!sessionQ.data?.start && !!currentTeamId,
    queryFn: async () => {
      if (!sessionQ.data?.start || !currentTeamId) return null
      const q = query(
        collection(db, SESSIONS_COLLECTION),
        where('teamId', '==', currentTeamId),
        where('start', '>', sessionQ.data.start),
        orderBy('start', 'asc'),
        limit(1),
      )
      const snap = await getDocs(q)
      if (snap.empty) return null
      return { id: snap.docs[0].id, ...snap.docs[0].data() } as Session
    },
  })

  // Subscription gate of this session's activity. Mirrors bookSession's resolution
  // order: a coaching session's own denormalised rule is authoritative (per-slot
  // overrides); group classes read the linked activity. null/empty = not gated.
  const gateActivity = (activitiesQ.data ?? []).find((a) => a.id === sessionQ.data?.activityId)
  const sessionRule = (sessionQ.data as { accessRule?: Parameters<typeof resolveActivityAccessRule>[0]['accessRule'] } | null | undefined)?.accessRule
  const isCoachingSession = sessionQ.data?.activityType === 'coaching'
  const accessRule = isCoachingSession
    ? sessionQ.data
      ? resolveActivityAccessRule({ accessRule: sessionRule, isFreeTrial: sessionQ.data.isFreeTrial })
      : null
    : gateActivity
      ? resolveActivityAccessRule(gateActivity)
      : null
  const requiredSubIds = activityRequiresSubscription(accessRule)

  // Contact docs (subscription snapshots included) for the roster coverage badges.
  // Shares the add-dialog's cache key; only fetched when the activity is gated.
  const rosterContactsQ = useQuery<Contact[]>({
    queryKey: ['contacts', 'active', currentTeamId],
    enabled: !!currentTeamId && !!requiredSubIds?.length,
    queryFn: async () => {
      const q = query(
        collection(db, CONTACTS_COLLECTION),
        where('teamId', '==', currentTeamId),
        where('deleted_at', '==', null),
        where('archived_at', '==', null),
        orderBy('lastname'),
        orderBy('firstname'),
      )
      const snap = await getDocs(q)
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Contact)
    },
  })

  // contactId → covered; contacts we can't see (archived etc.) get no badge.
  const rosterCoverage = new Map<string, boolean>(
    requiredSubIds?.length
      ? (rosterContactsQ.data ?? []).map((c) => [
          c.id,
          contactHoldsCoveringSubscription(c, requiredSubIds),
        ])
      : [],
  )
  const showsNoSubBadge = (contactId?: string | null) =>
    !!contactId && rosterCoverage.get(contactId) === false

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['session', sessionId] })
    qc.invalidateQueries({ queryKey: ['session-participants', sessionId] })
    qc.invalidateQueries({ queryKey: ['session-bookings', sessionId] })
    qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  // ── booking actions ───────────────────────────────────────────────────────────

  const confirmBooking = async (booking: Booking) => {
    const bookingRef = doc(db, SESSIONS_COLLECTION, sessionId, BOOKINGS_SUB, booking.id)
    await updateDoc(bookingRef, { status: 'confirmed' })
    // Add to participants subcollection
    const participantRef = doc(db, SESSIONS_COLLECTION, sessionId, PARTICIPANTS_SUBCOLLECTION, booking.contact || booking.id)
    await setDoc(participantRef, {
      contact: booking.contact || null,
      session: sessionId,
      firstname: booking.firstname,
      lastname: booking.lastname,
      fullname: `${booking.lastname ?? ''} ${booking.firstname ?? ''}`.trim(),
      checkedInAt: serverTimestamp(),
      checkedInBy: 'booking-confirm',
      confirmedFromBooking: true,
    })
    await updateDoc(doc(db, SESSIONS_COLLECTION, sessionId), { participants_count: increment(1) })
    invalidate()
  }

  const markNoShow = async (bookingId: string) => {
    await updateDoc(doc(db, SESSIONS_COLLECTION, sessionId, BOOKINGS_SUB, bookingId), { status: 'no_show' })
    invalidate()
  }

  const removeBooking = async (bookingId: string) => {
    await deleteDoc(doc(db, SESSIONS_COLLECTION, sessionId, BOOKINGS_SUB, bookingId))
    invalidate()
  }

  const removeParticipant = async (participantId: string) => {
    await deleteDoc(doc(db, SESSIONS_COLLECTION, sessionId, PARTICIPANTS_SUBCOLLECTION, participantId))
    await updateDoc(doc(db, SESSIONS_COLLECTION, sessionId), { participants_count: increment(-1) })
    invalidate()
  }

  // ── QR scanner ────────────────────────────────────────────────────────────────

  const handleQrScan = useCallback(async (raw: string) => {
    setScanMsg(null)
    try {
      const { c: contactId, h: hash } = JSON.parse(raw) as { c: string; h: string }
      const fn = httpsCallable(functions, 'checkInContact')
      const result = await fn({ sessionId, contactId, hash, scope: 'sessions' }) as { data: { success: boolean; alreadyCheckedIn?: boolean; contactName?: string } }
      setScanMsg({
        text: result.data.alreadyCheckedIn
          ? t('contactAlreadyCheckedIn', { name: result.data.contactName ?? '' })
          : t('contactCheckedIn', { name: result.data.contactName ?? '' }),
        ok: true,
      })
      invalidate()
    } catch (err: unknown) {
      setScanMsg({ text: (err as Error).message || t('invalidQrCode'), ok: false })
    }
    setTimeout(() => setScanMsg(null), 4000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const scanner = useQrScanner(handleQrScan)

  // toggleScanner intentionally removed — QR scanner is "coming soon" (button is disabled)
  useEffect(() => { if (!scanning) scanner.stop() }, [scanning, scanner])

  // ── derived ───────────────────────────────────────────────────────────────────

  const session = sessionQ.data
  const participants = participantsQ.data ?? []
  const bookings = bookingsQ.data ?? []
  const activities = activitiesQ.data ?? []

  const pendingBookings = bookings.filter((b) => !b.status || b.status === 'pending')
  const noShowBookings  = bookings.filter((b) => b.status === 'no_show')
  const existingParticipantIds = new Set(participants.map((p) => p.contact).filter(Boolean) as string[])
  const activity = activities.find((a) => a.id === session?.activityId)
  const { accent } = activityPalette(session?.activityId, activity?.color)

  // ── loading / not found ───────────────────────────────────────────────────────

  if (sessionQ.isLoading) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <p className="text-lg font-semibold">{t('sessionNotFound')}</p>
        <button onClick={() => router.back()} className="text-sm text-primary hover:underline">{t('goBack')}</button>
      </div>
    )
  }

  const hasBookings = pendingBookings.length > 0 || noShowBookings.length > 0

  return (
    <div className="space-y-5 max-w-2xl mx-auto pb-20">

      {/* Nav bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {t('backToSessions')}
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => prevQ.data && i18nRouter.push(`/sessions/${prevQ.data.id}` as Parameters<typeof i18nRouter.push>[0])}
            disabled={!prevQ.data}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
            title={t('previousSession')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => nextQ.data && i18nRouter.push(`/sessions/${nextQ.data.id}` as Parameters<typeof i18nRouter.push>[0])}
            disabled={!nextQ.data}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
            title={t('nextSession')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Session card */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
        {/* Accent top bar */}
        <div className="h-1 w-full" style={{ background: accent }} />
        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold tracking-tight">
                {session.activityName ?? formatDate(session.start)}
              </h1>
              <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{formatDate(session.start)} · {formatTime(session.start)}{session.end ? ` – ${formatTime(session.end)}` : ''}</span>
                </div>
                {session.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>{session.location}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{participants.length}</span>
                    <span>{t('checkInsStat')}</span>
                  </div>
                  {pendingBookings.length > 0 && (
                    <div className="flex items-center gap-1.5 text-amber-600">
                      <BookOpen className="h-3.5 w-3.5" />
                      <span className="font-medium">{pendingBookings.length}</span>
                      <span>{t('pendingBookingsStat')}</span>
                    </div>
                  )}
                  {session.allowBooking && (
                    <Badge variant="secondary" className="text-xs">{t('bookingOpenBadge')}</Badge>
                  )}
                </div>
              </div>
              {session.notes && (
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{session.notes}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setEditOpen(true)} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title={t('editTitle')}>
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => setDeleteOpen(true)} className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive" title={t('deleteTitle')}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Action row */}
        <div className="px-5 pb-4 flex flex-wrap gap-2">
          {/* QR scanner — coming soon; button is disabled and scanner UI is suppressed */}
          <div className="relative inline-flex items-center">
            <button
              disabled
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-muted text-muted-foreground opacity-60 cursor-not-allowed"
            >
              <QrCode className="h-4 w-4" />
              {t('checkInScannerButton')}
            </button>
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 select-none">
              {t('comingSoonBadge')}
            </span>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
          >
            <UserPlus className="h-4 w-4" /> {t('addContact')}
          </button>
          {session.allowBooking && (
            <a
              href={`/portal/${currentTeamId}/booking`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-muted transition-colors text-muted-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t('bookingPortalLink')}
            </a>
          )}
        </div>
      </div>

      {/* QR scanner section — disabled (coming soon); keep code for future re-enable */}
      {/* {scanner.active && ( ... )} */}

      {/* Portal bookings */}
      {hasBookings && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <SectionHeader icon={<BookOpen className="h-3.5 w-3.5" />} label={t('portalBookingsSection')} count={pendingBookings.length + noShowBookings.length} color="#D97706" />

          {/* Pending */}
          {pendingBookings.map((b) => (
            <div key={b.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
              <div className="h-9 w-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {b.firstname?.[0]}{b.lastname?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{b.lastname} {b.firstname}</p>
                {b.email && <p className="text-xs text-muted-foreground">{b.email}</p>}
              </div>
              {showsNoSubBadge(b.contact) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 flex-shrink-0" title={t('noSubBadgeTitle')}>
                  <AlertTriangle className="h-3 w-3" />
                  {t('noSubBadge')}
                </span>
              )}
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">{t('pendingBadge')}</Badge>
              <div className="flex items-center gap-1">
                <button onClick={() => confirmBooking(b)} className="p-1.5 rounded-lg hover:bg-green-50 text-muted-foreground hover:text-green-600 transition-colors" title={t('confirmAttendanceTitle')}>
                  <Check className="h-4 w-4" />
                </button>
                <button onClick={() => markNoShow(b.id)} className="p-1.5 rounded-lg hover:bg-orange-50 text-muted-foreground hover:text-orange-600 transition-colors" title={t('markNoShowTitle')}>
                  <UserX className="h-4 w-4" />
                </button>
                <button onClick={() => removeBooking(b.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title={t('removeBookingTitle')}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* No-shows */}
          {noShowBookings.length > 0 && (
            <>
              {pendingBookings.length > 0 && (
                <div className="px-1 pt-3 pb-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('noShowsSection')}</p>
                </div>
              )}
              {noShowBookings.map((b) => (
                <div key={b.id} className="flex items-center gap-3 py-2.5 border-b last:border-0 opacity-60">
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {b.firstname?.[0]}{b.lastname?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-through">{b.lastname} {b.firstname}</p>
                  </div>
                  <Badge variant="outline" className="text-xs text-destructive border-destructive/30">{t('noShowBadge')}</Badge>
                  <div className="flex items-center gap-1">
                    <button onClick={() => confirmBooking(b)} className="p-1.5 rounded-lg hover:bg-green-50 text-muted-foreground hover:text-green-600 transition-colors" title={t('overrideConfirmAttendanceTitle')}>
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => removeBooking(b.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title={t('removeTitle')}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Participants / check-ins */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <SectionHeader icon={<CheckCircle2 className="h-3.5 w-3.5" />} label={t('checkInsSection')} count={participants.length} color="#059669" />

        {participantsQ.isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}

        {!participantsQ.isLoading && participants.length === 0 && (
          <div className="py-8 text-center">
            <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">{t('noCheckInsYet')}</p>
            <button onClick={() => setAddOpen(true)} className="mt-2 text-xs text-primary hover:underline">{t('addContactManually')}</button>
          </div>
        )}

        {participants.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
            <div className="h-9 w-9 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {p.firstname?.[0]}{p.lastname?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{p.lastname} {p.firstname}</p>
              {p.confirmedFromBooking && (
                <p className="text-xs text-muted-foreground">{t('confirmedFromBooking')}</p>
              )}
            </div>
            {showsNoSubBadge(p.contact) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 flex-shrink-0" title={t('noSubBadgeTitle')}>
                <AlertTriangle className="h-3 w-3" />
                {t('noSubBadge')}
              </span>
            )}
            <button onClick={() => removeParticipant(p.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title={t('removeCheckInTitle')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Mobile FAB — add participant */}
      <button
        onClick={() => setAddOpen(true)}
        className="sm:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors z-40"
        aria-label={t('addContact')}
      >
        <UserPlus className="h-6 w-6" />
      </button>

      {/* Dialogs */}
      {currentTeamId && (
        <AddParticipantsDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          teamId={currentTeamId}
          sessionId={sessionId}
          existingIds={existingParticipantIds}
          onAdded={() => { invalidate(); setAddOpen(false) }}
          requiredSubscriptionTypeIds={requiredSubIds}
        />
      )}

      {currentTeamId && user && (
        <SessionFormDialog
          key={editOpen ? 'open' : 'closed'}
          open={editOpen}
          onOpenChange={setEditOpen}
          editing={session}
          activities={activities}
          teamId={currentTeamId}
          userId={user.uid}
          onSaved={invalidate}
        />
      )}

      <SessionDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        session={session}
        label={session.activityName ? `${session.activityName} – ${formatDate(session.start)}` : formatDate(session.start)}
        onDeleted={() => { qc.invalidateQueries({ queryKey: ['sessions'] }); router.back() }}
      />
    </div>
  )
}
