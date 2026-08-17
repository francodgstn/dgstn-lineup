'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRegisterTab } from '@/contexts/OpenTabsContext'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  updateDoc, deleteDoc, setDoc, increment, serverTimestamp, deleteField,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { FloatingSlot } from '@/components/layout/FloatingDock'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouter as useI18nRouter } from '@/i18n/navigation'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Pencil, Trash2, UserPlus,
  MapPin, Clock, Users, QrCode, BookOpen, CheckCircle2, UserX,
  Share2, X, Check, Ban, AlertTriangle, ListOrdered, Send,
} from 'lucide-react'
import {
  SESSIONS_COLLECTION, ACTIVITIES_COLLECTION, CONTACTS_COLLECTION,
  PARTICIPANTS_SUBCOLLECTION, WAITLIST_SUBCOLLECTION, resolveActivityAccessRule,
  activityRequiresSubscription, contactHoldsCoveringSubscription,
  bookingHoldsSeat, confirmClearedHoldFields, seatsFree,
} from '@linyup/shared'
import type { Session, Booking, Contact, Activity, WaitlistEntry } from '@linyup/shared'
import { WaiverChip, WaiverDoorCheckChip } from '@/components/WaiverChip'
import { useWaiverPolicy, useWaiverRoster } from '@/hooks/useWaiverStates'
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

/**
 * The reason code a waitlist callable refused with → the SessionDetail key that
 * says it in the coach's language.
 *
 * The callables' own `message` strings are English source, so rendering them —
 * which this page used to do — put "This class has no free seat to offer." in
 * front of a coach working in French or German. Every waitlist throw carries
 * `details.reason` for exactly this reason (see booking/waitlist/admin.ts), and
 * this table is the one place that turns them into copy. Sibling of
 * `claimErrorKey` on the public claim page, which does the same job for the
 * member-facing half of the same vocabulary.
 *
 * Returns null when nothing matched, so the caller can fall back to the server's
 * message rather than swallowing a refusal this table has not learned yet.
 */
function waitlistErrorKey(err: unknown): string | null {
  const e = err as { code?: string; details?: { reason?: string } }
  switch (e.details?.reason) {
    case 'session_full':
      return 'waitlistErrorNoSeat'
    case 'not_waiting':
      return 'waitlistErrorNotWaiting'
    case 'already_offered':
      return 'waitlistErrorAlreadyOffered'
    case 'booking_closed':
      return 'waitlistErrorBookingClosed'
    case 'waitlist_disabled':
      return 'waitlistErrorDisabled'
    case 'claim_window_too_short':
      return 'waitlistErrorWindowTooShort'
    case 'session_unavailable':
      return 'waitlistErrorSessionUnavailable'
    case 'undeliverable':
      return 'waitlistErrorUndeliverable'
    case 'entry_not_found':
      return 'waitlistErrorEntryGone'
    case 'permission_denied':
    case 'unauthenticated':
      return 'waitlistErrorPermission'
    default:
      break
  }
  // `assertManager` is shared with the Connect callables and throws without a
  // reason ("Manager access required"), so the code carries this one.
  const code = e.code?.replace(/^functions\//, '')
  if (code === 'permission-denied' || code === 'unauthenticated') return 'waitlistErrorPermission'
  return null
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

// STAFF CLASS BOOKING IS THE HOLE THE GATE CANNOT CLOSE, and this dialog is it.
// It writes `sessions/{id}/participants/{contactId}` DIRECTLY from the browser,
// permitted by the `schedule.manage` capability, so there is no server seam to
// gate — closing it would need a `bookParticipant` callable and a rules
// narrowing on a path coaches use daily. The posture is therefore SURFACE, DO
// NOT BLOCK: the note below says plainly that nobody is asked to sign, and the
// roster chip carries the state permanently. Stated here rather than left to be
// discovered, because "we have a waiver gate" is not literally true of this path.
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
  // One cached policy read, shared with the roster chip's own lookup. Absent a
  // required waiver the note never renders — a studio that asks for nothing must
  // not be told about a mechanism it does not use.
  const { data: waiverPolicy = [] } = useWaiverPolicy(open ? teamId : null)
  const teamRequiresWaiver = waiverPolicy.length > 0
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
        <div className="px-3 pt-3 pb-2 space-y-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchContactsPlaceholder')}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {teamRequiresWaiver && (
            <p className="text-xs text-muted-foreground">{t('addParticipantWaiverNote')}</p>
          )}
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
  const { currentTeamId, user, team } = useAuth()
  const teamSlug = team?.slug ?? ''
  const qc = useQueryClient()
  const [linkCopied, setLinkCopied] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  // QR scanner state — kept for when scanner is re-enabled; prefixed with _ to suppress unused-var lint
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null)
  // Waitlist row actions: the contactId currently in flight (so one row's
  // spinner doesn't freeze the whole queue), the entry pending a delete
  // confirmation, and the last refusal to surface.
  const [waitlistBusy, setWaitlistBusy] = useState<string | null>(null)
  const [waitlistRemoving, setWaitlistRemoving] = useState<WaitlistEntry | null>(null)
  const [waitlistError, setWaitlistError] = useState<string | null>(null)

  // Share the public booking link for THIS session. Native share sheet where the
  // platform has one (a coach on a phone sends it straight into WhatsApp), else
  // the clipboard. An ABSOLUTE url either way — a relative path is useless the
  // moment it leaves the app. A cancelled share sheet throws AbortError, which is
  // not a failure and must not surface as one.
  async function shareBookingLink() {
    if (!teamSlug) return
    const url = `${window.location.origin}/public/${teamSlug}/booking?session=${sessionId}`
    if (navigator.share) {
      try {
        await navigator.share({ url })
        return
      } catch {
        /* dismissed, or unavailable in this context — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      /* clipboard blocked (insecure origin, denied permission) — no-op */
    }
  }

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

  // The queue for this session. Read directly (team members may list it — see
  // firestore.rules); every WRITE goes through a callable, because the rules
  // deny client writes here and a browser write would bypass the capacity
  // transaction the whole feature rests on.
  const waitlistQ = useQuery<WaitlistEntry[]>({
    queryKey: ['session-waitlist', sessionId],
    queryFn: async () => {
      const snap = await getDocs(collection(db, SESSIONS_COLLECTION, sessionId, WAITLIST_SUBCOLLECTION))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as WaitlistEntry)
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
  // order: an appointment session's own denormalised rule is authoritative (per-slot
  // overrides); group classes read the linked activity. null/empty = not gated.
  const gateActivity = (activitiesQ.data ?? []).find((a) => a.id === sessionQ.data?.activityId)
  const sessionRule = (sessionQ.data as { accessRule?: Parameters<typeof resolveActivityAccessRule>[0]['accessRule'] } | null | undefined)?.accessRule
  const isAppointmentSession = sessionQ.data?.activityType === 'appointment'
  const accessRule = isAppointmentSession
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

  // ── The waiver chip ───────────────────────────────────────────────────────
  // Read LIVE from the signer rows for exactly the people on this roster, rather
  // than from the denormalised `booking.waiver_state`. That field is a snapshot
  // at booking time — right for the printed sheet, which describes the booking
  // as taken — and wrong here, where a revocation or a `require_resign` publish
  // since then is the thing a coach at the door needs to see. State both, or
  // "why does the sheet say signed and the screen say expired" becomes a support
  // ticket.
  //
  // Deliberately NOT `rosterContactsQ`'s shape: that fetches the whole active
  // contact list and is enabled only for gated activities, while a waiver chip
  // is wanted on every session. This is bounded by the roster.
  const waiverContactIds = [
    ...(bookingsQ.data ?? []).map((b) => b.contact),
    ...(participantsQ.data ?? []).map((p) => p.contact),
  ].filter((id): id is string => !!id)
  const waiverRoster = useWaiverRoster(
    currentTeamId,
    waiverContactIds,
    sessionQ.data?.activityId ?? null
  )
  const waiverStateOf = (contactId?: string | null) =>
    contactId ? waiverRoster.states.get(contactId) : undefined
  const waiverCheckOf = (contactId?: string | null) =>
    contactId ? waiverRoster.checks.get(contactId) : undefined

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['session', sessionId] })
    qc.invalidateQueries({ queryKey: ['session-participants', sessionId] })
    qc.invalidateQueries({ queryKey: ['session-bookings', sessionId] })
    // Freeing a seat can promote the front of the queue within the same
    // request, so the queue is refetched by every booking action, not only by
    // the two that touch it directly.
    qc.invalidateQueries({ queryKey: ['session-waitlist', sessionId] })
    qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  // ── booking actions ───────────────────────────────────────────────────────────

  const confirmBooking = async (booking: Booking) => {
    const bookingRef = doc(db, SESSIONS_COLLECTION, sessionId, BOOKINGS_SUB, booking.id)
    // Confirming settles a waitlist claim, so its hold markers go with the same
    // write — a confirmed seat is an ordinary booking. A leftover
    // `waitlist_claim` would otherwise keep this person out of
    // `sendBookingReminders` forever, and a claim that was mid-payment carries
    // the drop-in hold's `payment_status`/`expires_at` too: leaving those frees
    // the seat again at the deadline and puts a confirmed booking in
    // `releaseExpiredBookingHolds`' delete query. One shared patch, so all four
    // confirm surfaces settle a booking into the same shape.
    await updateDoc(bookingRef, {
      status: 'confirmed',
      ...confirmClearedHoldFields(booking, deleteField()),
    })
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

  // ── waitlist actions ──────────────────────────────────────────────────────────
  //
  // Both are callables. A client write would be denied by the rules anyway, and
  // that denial is deliberate: offering a seat mints a booking hold and rewrites
  // `bookings_count` inside one transaction, and removing an entry may have to
  // give a held seat back — neither is expressible as a document write.

  const callWaitlist = async (
    name: 'promoteWaitlistEntry' | 'removeWaitlistEntry',
    entry: WaitlistEntry
  ) => {
    if (!currentTeamId) return
    setWaitlistBusy(entry.id)
    setWaitlistError(null)
    try {
      const fn = httpsCallable(functions, name)
      await fn({ teamId: currentTeamId, sessionId, contactId: entry.id })
      invalidate()
    } catch (err: unknown) {
      // The reason code names the guard that refused; the message is English
      // source and is the LAST resort, for a refusal the table above has not
      // learned yet.
      const key = waitlistErrorKey(err)
      setWaitlistError(key ? t(key) : (err as Error).message || t('waitlistActionFailed'))
    } finally {
      setWaitlistBusy(null)
    }
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

  useEffect(() => {
    if (scanning) scanner.start()
    else scanner.stop()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  // ── derived ───────────────────────────────────────────────────────────────────

  const session = sessionQ.data
  const participants = participantsQ.data ?? []
  const bookings = bookingsQ.data ?? []
  const activities = activitiesQ.data ?? []

  const pendingBookings = bookings.filter((b) => !b.status || b.status === 'pending')
  const noShowBookings  = bookings.filter((b) => b.status === 'no_show')

  // The live queue, in queue order. 'offered' stays visible — that person's seat
  // is held but unclaimed, which is precisely the state a coach needs to see.
  const waitlist = (waitlistQ.data ?? [])
    .filter((e) => e.status !== 'claimed')
    .sort((a, b) => (a.joined_at?.toMillis() ?? 0) - (b.joined_at?.toMillis() ?? 0))
  const waitingCount = waitlist.filter((e) => e.status === 'waiting').length
  // Same predicate the server's capacity gate uses, so "Offer now" is disabled
  // for exactly the sessions the promoter would refuse. A live offer already
  // holds its seat (bookingHoldsSeat counts the claim hold), so it is correctly
  // subtracted here too.
  const freeSeats = seatsFree(
    session?.max_participants,
    bookings.filter((b) => bookingHoldsSeat(b)).length
  )
  const existingParticipantIds = new Set(participants.map((p) => p.contact).filter(Boolean) as string[])
  const activity = activities.find((a) => a.id === session?.activityId)
  const { accent } = activityPalette(session?.activityId, activity?.color)

  // Register this session as an open tab once loaded (mirrors the header title).
  useRegisterTab({
    href: `/sessions/${sessionId}`,
    label: session ? (session.activityName ?? formatDate(session.start)) : '',
    entityKind: 'session',
    enabled: !!session,
  })

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
                  {waitingCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <ListOrdered className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">{waitingCount}</span>
                      <span>{t('waitlistStat')}</span>
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
          <button
            onClick={() => setScanning((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              scanning ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'
            }`}
          >
            <QrCode className="h-4 w-4" />
            {scanning ? t('stopScannerButton') : t('checkInScannerButton')}
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-muted transition-colors"
          >
            <UserPlus className="h-4 w-4" /> {t('addContact')}
          </button>
          {/* SHARE the link to THIS session, don't open it — the coach's actual
              need is sending it to someone, and they can already see the session
              on the page they are standing on.
              `?session=` is the booking form's highest-precedence entry point and
              degrades on its own to the slot list when the session can't be
              honoured (past, full, unpublished), so a link that has aged in
              someone's inbox is never a dead end.
              Slug, not team id: public routes are slug-addressed. The previous
              href pointed at a `/portal/` prefix that is not a route at all, so
              this button 404'd. */}
          {session.allowBooking && teamSlug && (
            <button
              onClick={shareBookingLink}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-muted transition-colors text-muted-foreground"
            >
              {linkCopied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> {t('bookingLinkCopied')}
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" /> {t('bookingLinkShare')}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* QR scanner */}
      {scanning && (
        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
          <div className="relative aspect-square w-full max-w-sm mx-auto bg-black">
            <video
              ref={scanner.videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {scanMsg && (
              <div
                className={`absolute inset-x-2 top-2 rounded-lg px-3 py-2 text-center text-sm font-medium shadow ${
                  scanMsg.ok ? 'bg-green-600 text-white' : 'bg-destructive text-destructive-foreground'
                }`}
              >
                {scanMsg.text}
              </div>
            )}
          </div>
          {scanner.error ? (
            <p className="px-5 py-3 text-sm text-destructive">{scanner.error}</p>
          ) : (
            <p className="px-5 py-3 text-sm text-muted-foreground">{t('qrScannerHint')}</p>
          )}
        </div>
      )}

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
              <WaiverChip state={waiverStateOf(b.contact)} />
              <WaiverDoorCheckChip check={waiverCheckOf(b.contact)} />
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

      {/* Waitlist — the queue behind a full class.
          Shown when the activity runs one (so a coach can see the door is open
          even on a class nobody has queued for yet) or when entries exist at
          all — never on the sessions that have neither, where it would be noise
          on the great majority of classes that never fill. */}
      {(activity?.waitlistEnabled === true || waitlist.length > 0) && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <SectionHeader icon={<ListOrdered className="h-3.5 w-3.5" />} label={t('waitlistSection')} count={waitingCount} color="#7C3AED" />

          {waitlistError && (
            <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{waitlistError}</p>
          )}

          {waitlist.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">{t('waitlistEmpty')}</p>
          )}

          {waitlist.map((e, i) => {
            const terminal = e.status === 'expired' || e.status === 'left'
            const offerMsLeft = e.offer_expires_at ? e.offer_expires_at.toMillis() - Date.now() : null
            return (
              <div key={e.id} className={`flex items-center gap-3 py-2.5 border-b last:border-0 ${terminal ? 'opacity-50' : ''}`}>
                <div className="h-9 w-9 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold flex-shrink-0 tabular-nums">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{e.lastname} {e.firstname}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[e.email, e.phone].filter(Boolean).join(' · ')}
                  </p>
                  {e.joined_at && (
                    <p className="text-xs text-muted-foreground">
                      {t('waitlistWaitingSince', { date: formatDate(e.joined_at) })}
                    </p>
                  )}
                </div>
                {e.status === 'offered' && offerMsLeft !== null && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {offerMsLeft > 0
                      ? t('waitlistOfferExpiresIn', { time: `${Math.max(1, Math.round(offerMsLeft / 60000))} min` })
                      : t('waitlistOfferLapsed')}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={`text-xs ${e.status === 'offered' ? 'text-amber-600 border-amber-300' : ''}`}
                >
                  {e.status === 'waiting'
                    ? t('waitlistStatusWaiting')
                    : e.status === 'offered'
                      ? t('waitlistStatusOffered')
                      : e.status === 'expired'
                        ? t('waitlistStatusExpired')
                        : t('waitlistStatusLeft')}
                </Badge>
                <div className="flex items-center gap-1">
                  {/* Only ever offered to somebody still WAITING, and only when
                      a seat is genuinely free — the callable re-checks both, but
                      a button that always fails is not a button. */}
                  {e.status === 'waiting' && (
                    <button
                      onClick={() => callWaitlist('promoteWaitlistEntry', e)}
                      disabled={waitlistBusy !== null || freeSeats <= 0}
                      className="p-1.5 rounded-lg hover:bg-violet-50 text-muted-foreground hover:text-violet-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                      title={freeSeats <= 0 ? t('waitlistOfferNowDisabled') : t('waitlistOfferNow')}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {!terminal && (
                    <button
                      onClick={() => setWaitlistRemoving(e)}
                      disabled={waitlistBusy !== null}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                      title={t('waitlistRemove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
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
            {/* A participant row may have NO booking at all — a staff add, or a
                kiosk/self check-in — which is exactly the person whose waiver
                nobody collected. `booking.waiver_state` cannot reach them, so
                this reads the signer row. */}
            <WaiverChip state={waiverStateOf(p.contact)} />
            <WaiverDoorCheckChip check={waiverCheckOf(p.contact)} />
            <button onClick={() => removeParticipant(p.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title={t('removeCheckInTitle')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Mobile FAB — add participant */}
      <FloatingSlot lane="page-primary" className="sm:hidden">
        <button
          onClick={() => setAddOpen(true)}
          className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
          aria-label={t('addContact')}
        >
          <UserPlus className="h-6 w-6" />
        </button>
      </FloatingSlot>

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

      {/* Removing someone from a queue is destructive and unrecoverable — they
          would have to join again, at the back. Confirmation dialog, like every
          other destructive action here. */}
      <Dialog open={!!waitlistRemoving} onOpenChange={(open) => !open && setWaitlistRemoving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{t('waitlistRemove')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('waitlistRemoveConfirm', {
              name: waitlistRemoving
                ? `${waitlistRemoving.firstname ?? ''} ${waitlistRemoving.lastname ?? ''}`.trim()
                : '',
            })}
          </p>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => {
                const entry = waitlistRemoving
                setWaitlistRemoving(null)
                if (entry) callWaitlist('removeWaitlistEntry', entry)
              }}
              className="flex-1 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              {t('waitlistRemove')}
            </button>
            <button
              onClick={() => setWaitlistRemoving(null)}
              className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('waitlistRemoveCancel')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

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
