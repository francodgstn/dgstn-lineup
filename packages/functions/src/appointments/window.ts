/* eslint-disable no-console */
// Appointments are ACTIVITY-BOUND and AVAILABILITY-ONLY. A coach publishes an
// `Availability` (the *when* — a daily range or explicit times, Calendly-style)
// linked to one or more `type: 'appointment'` Activities (the *what* — name,
// duration(s), memberBenefit). Nothing is ever pre-generated: a start time is
// indeterminate until the client picks an activity, so free time is computed
// on the fly here, and a Session is created lazily, overlap-safe, at booking
// time.
//
//  • listAvailability — public: free start times per coach/activity/day/duration.
//  • bookAppointment  — public: resolves the covering availability server-side,
//    runs the PRICE gate (the only gate — see ActivityMemberBenefit), then
//    delegates the overlap-safe create-session + book to the shared
//    appointments/booking.ts transaction.
import * as admin from 'firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { generateSecureToken } from '../utils/crypto'
import { getHostingUrl } from '../utils/env'
import { to } from '../utils/async'
import { loadContactPaymentSnapshot } from '../booking/access'
import { attachWaiverContact, enforceWaiverGate, parseWaiverSubmissions } from '../waivers/gate'
import {
  AVAILABILITY_COLLECTION,
  AVAILABILITY_EXCEPTIONS_COLLECTION,
  ACTIVITIES_COLLECTION,
  TEAMS_COLLECTION,
  GUEST_SNAPSHOT,
  appointmentSlotBlocked,
  resolveAppointmentDurations,
  resolveDurationSale,
  resolvePaymentOptions,
  type Activity,
  type BookingContactField,
  type ActivityDuration,
  type ActivityMemberBenefit,
  type Availability,
  type Benefit,
  localizedPublicUrl,
} from '@linyup/shared'
import {
  DAY_MS,
  MAX_SESSION_MS,
  loadAppointmentBookingContext,
  parseHHMM,
  resolveAppointmentCaller,
  resolveOrCreateAppointmentContact,
  runAppointmentSlotTransaction,
  type WindowTemplate,
} from './booking'
import { sendAppointmentBookingEmails } from './emails'
import { getDatePartsInTz, localTimeToUtc } from './index'
import { resolveContactFieldPatchForBooking } from '../booking/contactFields'

const DEFAULT_RANGE_DAYS = 28
const MAX_RANGE_DAYS = 60

interface BusyInterval {
  start: number
  end: number
}

// Does [start, start+dur) collide with any busy interval expanded by buffer?
function conflicts(startMs: number, durMs: number, busy: BusyInterval[], bufferMs: number): boolean {
  const endMs = startMs + durMs
  return busy.some((b) => startMs < b.end + bufferMs && endMs > b.start - bufferMs)
}

// Loaded/derived shape of a `type: 'appointment'` activity — the *what*.
// No accessRule here any more — appointments dropped the access gate entirely;
// money (durations + memberBenefit) is the only gate.
interface ActivityInfo {
  id: string
  name: string
  /** Priced duration menu (resolveAppointmentDurations default applied). */
  durations: ActivityDuration[]
  memberBenefit?: ActivityMemberBenefit | Benefit
  /** Per-activity cancellation-policy override; the picker falls back to the
   *  team default it already has (TeamPublicProfile.bookingCancellationPolicy).
   *  Display-only, and the same text the confirmation email appends — the point
   *  is that the visitor reads it BEFORE the button, not after. */
  cancellationPolicy?: string | null
  /** The activity's own CONTACT fields, which extend the team-wide list. Sent
   *  to the picker so the guest step asks for exactly what the booking
   *  callables will accept — the resolver runs on both sides. */
  contactFields?: BookingContactField[]
}

function toActivityInfo(id: string, a: Activity): ActivityInfo | null {
  const durations = resolveAppointmentDurations(a)
  if (!durations.length) return null
  return {
    id,
    name: a.name || 'Appointment',
    durations,
    memberBenefit: a.memberBenefit,
    cancellationPolicy: a.cancellationPolicy?.trim() || null,
    contactFields: a.contactFields,
  }
}

// Enumerate candidate starts for (template, activity durations) across
// [nowMs, toMs], merging into a per-day, per-duration accumulator so several
// availabilities offering the SAME activity combine into one listing.
function accumulateCandidates(
  tpl: WindowTemplate,
  durations: number[],
  busy: BusyInterval[],
  nowMs: number,
  toMs: number,
  daysMap: Map<number, Record<string, Set<number>>>
): void {
  const bufferMs = (tpl.bufferMinutes || 0) * 60_000
  const daysOfWeek = tpl.recurrence?.daysOfWeek ?? []
  const startDate = tpl.recurrence?.startDate ? tpl.recurrence.startDate.toMillis() : 0
  const endDate = tpl.recurrence?.endDate ? tpl.recurrence.endDate.toMillis() : Infinity

  let gran = 0
  let winStartHM: [number, number] | null = null
  let winEndHM: [number, number] | null = null
  if (tpl.mode === 'range') {
    if (!tpl.window) return
    winStartHM = parseHHMM(tpl.window.start)
    winEndHM = parseHHMM(tpl.window.end)
    gran = (tpl.granularityMinutes || 15) * 60_000
  }

  const cursor = new Date(nowMs)
  cursor.setUTCHours(0, 0, 0, 0)
  while (cursor.getTime() <= toMs) {
    const { year, month, day, dayOfWeek } = getDatePartsInTz(cursor)
    const dayMidnight = localTimeToUtc(year, month, day, 0, 0).getTime()
    if (daysOfWeek.includes(dayOfWeek) && dayMidnight >= startDate - DAY_MS && dayMidnight <= endDate) {
      for (const dur of durations) {
        const durMs = dur * 60_000
        const starts: number[] = []
        if (tpl.mode === 'times') {
          for (const hhmm of tpl.times ?? []) {
            const [h, m] = parseHHMM(hhmm)
            const s = localTimeToUtc(year, month, day, h, m).getTime()
            if (s <= nowMs) continue
            // 'times' mode: no window bound — just don't spill past end of day.
            if (s + durMs > dayMidnight + DAY_MS) continue
            if (conflicts(s, durMs, busy, bufferMs)) continue
            starts.push(s)
          }
        } else if (winStartHM && winEndHM) {
          const winStart = localTimeToUtc(year, month, day, winStartHM[0], winStartHM[1]).getTime()
          const winEnd = localTimeToUtc(year, month, day, winEndHM[0], winEndHM[1]).getTime()
          for (let s = winStart; s + durMs <= winEnd; s += gran) {
            if (s <= nowMs) continue
            if (conflicts(s, durMs, busy, bufferMs)) continue
            starts.push(s)
          }
        }
        if (starts.length) {
          let byDur = daysMap.get(dayMidnight)
          if (!byDur) {
            byDur = {}
            daysMap.set(dayMidnight, byDur)
          }
          const set = byDur[String(dur)] ?? (byDur[String(dur)] = new Set<number>())
          for (const s of starts) set.add(s)
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

// ─── listAvailability (public) ─────────────────────────────────────────────────

export const listAvailability = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    providerId?: string
    activityId?: string
    days?: number
  }
  if (!data?.teamId) throw new HttpsError('invalid-argument', 'teamId is required')

  const rangeDays = Math.min(Math.max(Math.floor(data.days ?? DEFAULT_RANGE_DAYS), 1), MAX_RANGE_DAYS)
  const db = admin.firestore()
  const nowMs = Date.now()
  const toMs = nowMs + rangeDays * DAY_MS

  // Both 'range' and 'times' modes are live — no mode filter here any more.
  const snap = await db
    .collection(AVAILABILITY_COLLECTION)
    .where('teamId', '==', data.teamId)
    .where('status', '==', 'active')
    .get()
  let templates: WindowTemplate[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Availability) }))
  if (data.providerId) templates = templates.filter((t) => t.providerId === data.providerId)
  if (templates.length === 0) return { coaches: [] }

  // CAN THE STUDIO BE PAID? A priced duration is a door that only opens through
  // Stripe: `createAppointmentCheckout` calls requireChargeableAccount and
  // `bookAppointment` refuses a payable caller with `payment_required`. So when
  // the studio has no chargeable account, offering a priced length puts a slot
  // in front of a visitor that neither path can complete (UX-33) — the menu
  // drops those lengths instead, here rather than in each client, so the web
  // picker and the mobile app cannot disagree.
  //
  // "Cannot take money" is NOT "free": an UNPRICED duration stays bookable for
  // anyone, exactly as before. The deliberate cost is a member whose
  // `memberBenefit` would have covered a priced length free — they lose that
  // length too while the account is unfinished, because this listing is built
  // once for every caller (anonymous included) and does not resolve the
  // caller's coverage. Finishing Connect onboarding restores it.
  const teamSnap = await db.collection(TEAMS_COLLECTION).doc(data.teamId).get()
  const teamPayments = teamSnap.data()?.payments as
    | { connectStatus?: string; connectEnabled?: boolean }
    | undefined
  const canCharge =
    teamPayments?.connectEnabled !== false && teamPayments?.connectStatus === 'enabled'

  // Batch-load the union of referenced activities; keep only bookable appointment offerings.
  const activityIds = new Set<string>()
  for (const t of templates) for (const id of t.activityIds ?? []) activityIds.add(id)
  const activityDocs = await Promise.all(
    [...activityIds].map((id) => db.collection(ACTIVITIES_COLLECTION).doc(id).get())
  )
  const activityMap = new Map<string, ActivityInfo>()
  for (const doc of activityDocs) {
    if (!doc.exists) continue
    const a = doc.data() as Activity
    if (a.type !== 'appointment' || a.teamId !== data.teamId) continue
    if (data.activityId && doc.id !== data.activityId) continue
    const info = toActivityInfo(doc.id, a)
    if (!info) continue
    if (!canCharge) {
      // 'priced' is the only mode that needs Stripe. A benefit_only length is
      // paid for by the subscription/pack the contact already holds, so it
      // survives an unfinished Connect account exactly as an unpriced one does.
      const bookable = info.durations.filter((d) => resolveDurationSale(d).mode !== 'priced')
      if (bookable.length === 0) continue // nothing here anyone could book
      info.durations = bookable
    }
    activityMap.set(doc.id, info)
  }
  if (activityMap.size === 0) return { coaches: [] }

  // Group templates by provider so a provider's busy sessions are queried once.
  const byProvider = new Map<string, WindowTemplate[]>()
  for (const t of templates) {
    const offersBookable = (t.activityIds ?? []).some((id) => activityMap.has(id))
    if (!offersBookable) continue
    const arr = byProvider.get(t.providerId)
    if (arr) arr.push(t)
    else byProvider.set(t.providerId, [t])
  }
  if (byProvider.size === 0) return { coaches: [] }

  interface ActivityAccumulator {
    activityId: string
    activityName: string
    durations: ActivityDuration[]
    memberBenefit?: ActivityMemberBenefit | Benefit
    cancellationPolicy: string | null
    contactFields: BookingContactField[] | null
    location: string | null
    onlineUrl: string | null
    daysMap: Map<number, Record<string, Set<number>>>
  }

  const coaches: unknown[] = []
  for (const [providerId, providerTemplates] of byProvider) {
    // Busy = this provider's slot-blocking sessions overlapping the range —
    // EXPIRED paid-booking holds don't block (lazy release, see
    // appointmentSlotBlocked): a lapsed checkout must free its slot immediately,
    // not wait for the daily sweep.
    const busySnap = await db
      .collection('sessions')
      .where('teamId', '==', data.teamId)
      .where('providerId', '==', providerId)
      .where('start', '>=', Timestamp.fromMillis(nowMs - MAX_SESSION_MS))
      .where('start', '<=', Timestamp.fromMillis(toMs))
      .get()
    const busy: BusyInterval[] = busySnap.docs
      .map((d) => d.data())
      .filter((s) => appointmentSlotBlocked(s as { status?: string; hold_expires_at?: Timestamp | null }, nowMs))
      .map((s) => ({ start: (s.start as Timestamp).toMillis(), end: (s.end as Timestamp).toMillis() }))

    // Provider time-off (availability_exceptions) OVERRIDES the templates — each
    // window is an extra busy interval, so accumulateCandidates skips any slot
    // that overlaps it (a coach off "this week"/"this day"/"this slot").
    const exSnap = await db
      .collection(AVAILABILITY_EXCEPTIONS_COLLECTION)
      .where('teamId', '==', data.teamId)
      .where('providerId', '==', providerId)
      .get()
    for (const d of exSnap.docs) {
      const e = d.data()
      const s = (e.start as Timestamp).toMillis()
      const en = (e.end as Timestamp).toMillis()
      if (en > nowMs && s < toMs) busy.push({ start: s, end: en })
    }

    // GROUP BY (provider, activity) — merge days across a provider's several
    // availabilities that offer the same activity (e.g. "Saturday mornings" AND
    // "Weekday evenings" both offering the same 60' session).
    const activityAcc = new Map<string, ActivityAccumulator>()
    for (const tpl of providerTemplates) {
      const offered = (tpl.activityIds ?? []).filter((id) => activityMap.has(id))
      for (const activityId of offered) {
        const info = activityMap.get(activityId)!
        let acc = activityAcc.get(activityId)
        if (!acc) {
          // Location/onlineUrl: take them from the first contributing availability.
          // Edge case: differing locations across schedules show the first —
          // booking always resolves the real one from the matched availability.
          acc = {
            activityId,
            activityName: info.name,
            durations: info.durations,
            memberBenefit: info.memberBenefit,
            cancellationPolicy: info.cancellationPolicy ?? null,
            contactFields: info.contactFields ?? null,
            location: tpl.location ?? null,
            onlineUrl: tpl.onlineUrl ?? null,
            daysMap: new Map(),
          }
          activityAcc.set(activityId, acc)
        }
        accumulateCandidates(tpl, info.durations.map((d) => d.minutes), busy, nowMs, toMs, acc.daysMap)
      }
    }

    const activities: unknown[] = []
    for (const acc of activityAcc.values()) {
      const days = [...acc.daysMap.entries()]
        .map(([dayMs, byDur]) => ({
          dayMs,
          slotsByDuration: Object.fromEntries(
            Object.entries(byDur).map(([dur, set]) => [dur, [...set].sort((a, b) => a - b)])
          ),
        }))
        .sort((a, b) => a.dayMs - b.dayMs)
      if (days.length) {
        activities.push({
          activityId: acc.activityId,
          activityName: acc.activityName,
          // Priced duration menu so the picker can show prices per length.
          // `benefitOnly` rides along because the picker must be able to say
          // "not sold individually — {pack} opens it" instead of rendering a
          // free-looking slot the server will refuse (UX-70).
          durations: acc.durations.map((d) => {
            const sale = resolveDurationSale(d)
            return {
              minutes: d.minutes,
              priceAmount: sale.priceAmount,
              benefitOnly: sale.mode === 'benefit_only',
            }
          }),
          // Verbatim from the activity — the picker mirrors the resolver
          // (resolveEffectiveAppointmentPrice) for display; the server always
          // re-resolves authoritatively at booking/checkout.
          memberBenefit: acc.memberBenefit ?? null,
          // Display-only; the picker falls back to the team-wide default.
          cancellationPolicy: acc.cancellationPolicy,
          // Extends the team-wide contact-field list on the guest step.
          contactFields: acc.contactFields,
          location: acc.location,
          onlineUrl: acc.onlineUrl,
          days,
        })
      }
    }
    if (activities.length) {
      coaches.push({ providerId, providerName: providerTemplates[0].providerName, activities })
    }
  }

  return { coaches }
})

// ─── bookAppointment (public) — the FREE path ──────────────────────────────────
// Composes the shared appointments/booking.ts helpers. THE PRICE IS THE GATE —
// appointments have no access gate any more: a guest may always attempt to
// book. Only the PRICE gate can refuse: a priced duration whose effective price
// (base, or the caller's resolved member-benefit price) is an AMOUNT refuses
// here; the client must use createAppointmentCheckout instead. An unpriced
// duration always resolves free, for anyone.

export const bookAppointment = onCall(async (request) => {
  const data = request.data as {
    teamId?: string
    providerId?: string
    activityId?: string
    startMs?: number
    durationMinutes?: number
    contactDetails?: { firstname: string; lastname: string; email: string; phone?: string }
    authenticatedContactId?: string
    verificationCodeId?: string
    /** Ticks from the waiver step — see waivers/gate.ts. */
    waiverAcceptances?: unknown
    /** Answers to the studio's book-form contact fields — narrowed server side
     *  against the resolved list. See booking/contactFields.ts. */
    contactFieldAnswers?: Record<string, unknown>
  }
  if (
    !data?.teamId ||
    !data?.providerId ||
    !data?.activityId ||
    typeof data.startMs !== 'number' ||
    typeof data.durationMinutes !== 'number'
  ) {
    throw new HttpsError(
      'invalid-argument',
      'teamId, providerId, activityId, startMs and durationMinutes are required'
    )
  }
  const { teamId, providerId, activityId, startMs, durationMinutes } = data

  const ctx = await loadAppointmentBookingContext({ teamId, providerId, activityId, startMs, durationMinutes })
  const caller = await resolveAppointmentCaller(request, { ...data, teamId })

  // ── Price gate — the ONLY gate. The shared resolver answers covered /
  // spend_credits / pay for this caller (guests always land on base price).
  const snapshot = caller.authenticatedContact
    ? await loadContactPaymentSnapshot({
        teamId,
        contact: caller.authenticatedContact,
        relevantTypeIds: ctx.activity.memberBenefit?.subscriptionTypeIds ?? [],
      })
    : GUEST_SNAPSHOT
  const priced = resolvePaymentOptions(snapshot, {
    kind: 'appointment',
    duration: ctx.chosenDuration,
    benefit: ctx.activity.memberBenefit ?? null,
  })
  const priceOption = priced.options[0]
  if (priceOption?.type === 'pay') {
    throw new HttpsError('failed-precondition', 'This duration requires payment.', {
      reason: 'payment_required',
      priceAmount: priceOption.amount,
    })
  }
  // NO OPTION AT ALL — a benefit_only length (UX-70) the caller has no way into.
  // This branch must exist and must come BEFORE the free path: without it an
  // empty options array falls straight through to "books without spending",
  // which is the free one-to-one the whole feature exists to prevent. The
  // resolver's denial is passed through verbatim so the picker can say sign in
  // vs buy the pack.
  if (!priceOption) {
    throw new HttpsError('failed-precondition', 'This duration is not sold individually.', {
      reason: priced.denial ?? 'no_subscription',
    })
  }
  // Free path: 'covered' (unpriced, or included via an unmetered subscription)
  // books without spending; 'spend_credits' burns one credit transactionally.
  const creditSpendTypeId =
    priceOption?.type === 'spend_credits' ? priceOption.via.subscriptionTypeId : null
  const viaSubscriptionTypeId =
    priceOption?.type === 'spend_credits'
      ? priceOption.via.subscriptionTypeId
      : priceOption?.type === 'covered' && priceOption.via.reason === 'benefit_included'
        ? priceOption.via.subscriptionTypeId
        : null

  // ── The waiver gate — after the caller is identified, before the contact is
  // created. Everything above is a read; `resolveOrCreateAppointmentContact`
  // below is the first write, so a refusal here costs nothing.
  //
  // The one cost that IS real on this rail is upstream and unavoidable:
  // `resolveAppointmentCaller` marks the OTP code used at its own entry, so a
  // refusal that sends the caller back to the email step costs them one
  // re-verification against a three-per-hour budget. That is why the picker
  // presents the step BEFORE calling this callable rather than reacting to the
  // refusal — the refusal is the floor, not the plan. ──
  const waiverNowMs = Date.now()
  let waiverOutcome = await enforceWaiverGate({
    teamId,
    activityId,
    subject: {
      contactId: caller.authenticatedContact?.id ?? null,
      name: `${caller.sanitized.firstname} ${caller.sanitized.lastname}`.trim(),
      email: caller.sanitized.email,
    },
    submissions: parseWaiverSubmissions(data.waiverAcceptances),
    source: 'appointment',
    // See the same three-way distinction in bookSession: an OTP proves control
    // of that mailbox, a contact session identifies only the contact.
    signerEmailVerifiedBy: data.authenticatedContactId
      ? 'verified_code'
      : caller.authenticatedContact
        ? 'session'
        : 'none',
    // The address that strength is ABOUT — the mailbox the code went to, which
    // on this rail is routinely a parent's rather than the subject's. null on
    // the session and guest paths.
    signerEmail: caller.verifiedEmail,
    ip: request.rawRequest?.ip ?? null,
    userAgent: (request.rawRequest?.headers?.['user-agent'] as string | undefined) ?? null,
    locale: null,
    nowMs: waiverNowMs,
  })

  // ── Resolve/create the contact — guests are always allowed now (no access gate). ──
  const { contactId, isNewContact } = await resolveOrCreateAppointmentContact({
    teamId,
    plan: ctx.plan,
    sanitized: caller.sanitized,
    authenticatedContact: caller.authenticatedContact,
    // The book form's contact-field answers, already narrowed against the
    // team + activity list. `{}` — and no extra read — when none were sent.
    contactFieldPatch: await resolveContactFieldPatchForBooking({
      teamId,
      team: ctx.team,
      activityContactFields: ctx.activity.contactFields,
      answers: data.contactFieldAnswers,
      existing: caller.authenticatedContact,
    }),
  })
  waiverOutcome = attachWaiverContact(waiverOutcome, contactId)

  // ── Overlap-safe create (transaction) ──
  const bookingToken = generateSecureToken()
  const sessionRef = admin.firestore().collection('sessions').doc(`apt_${providerId}_${ctx.start.getTime()}`)

  const sessionDoc = {
    teamId,
    templateId: ctx.tpl.id,
    origin: 'window',
    activityType: 'appointment',
    // The session INHERITS FROM THE ACTIVITY: name/capacity come from the
    // offering the client picked, not the schedule — exactly like a class.
    // NOTE: no accessRule any more — appointments dropped the gate entirely.
    activityId,
    activityName: ctx.activity.name,
    // Denormalised from the activity — see `autoConfirm` above.
    autoConfirm: ctx.autoConfirm,
    providerId,
    providerName: ctx.providerName,
    start: Timestamp.fromDate(ctx.start),
    end: Timestamp.fromDate(ctx.end),
    duration_minutes: durationMinutes,
    // An appointment is a provider's exclusive time — one booking per slot, by
    // definition. trackBookings reads this to drive the 'full' flip.
    max_participants: 1,
    bookings_count: 1,
    // Location/onlineUrl come from the matched availability (the *when*).
    location: ctx.tpl.location ?? null,
    onlineUrl: ctx.tpl.onlineUrl ?? null,
    allowBooking: true,
    status: 'full',
    has_bookings: true,
    last_booking_at: FieldValue.serverTimestamp(),
    created_at: FieldValue.serverTimestamp(),
  }
  const bookingDoc = {
    firstname: caller.sanitized.firstname,
    lastname: caller.sanitized.lastname,
    email: caller.sanitized.email,
    phone: caller.sanitized.phone,
    contact: contactId,
    session: sessionRef.id,
    teamId,
    joinedAt: FieldValue.serverTimestamp(),
    fromBioLink: true,
    is_new_contact: isNewContact,
    booking_token: bookingToken,
    authenticated_booking: !!caller.authenticatedContact,
    // The resolved member-benefit type (free/discount), if any — not an access
    // gate match any more, just which benefit (if any) priced this booking.
    subscription_type_id: viaSubscriptionTypeId,
    // The slot is taken the moment it's booked either way (bookings_count: 1
    // above, unconditionally) — only the booking's own status differs by
    // autoConfirm; a non-auto-confirm appointment still holds capacity but
    // stays unconfirmed until the studio confirms it.
    ...(ctx.autoConfirm && {
      status: 'confirmed' as const,
      fullname: `${caller.sanitized.firstname} ${caller.sanitized.lastname}`,
    }),
    ...(waiverOutcome.bookingWaiverState
      ? { waiver_state: waiverOutcome.bookingWaiverState }
      : {}),
  }

  await runAppointmentSlotTransaction({
    sessionRef,
    sessionDoc,
    bookingDocId: contactId,
    bookingDoc,
    teamId,
    providerId,
    startMs: ctx.start.getTime(),
    endMs: ctx.end.getTime(),
    bufferMs: ctx.bufferMs,
    creditSpend: creditSpendTypeId ? { contactId, subscriptionTypeId: creditSpendTypeId } : undefined,
    // The acceptance rides INSIDE the slot transaction — the free path's seat
    // and its signature commit together or not at all.
    waiverLedger: { accepts: waiverOutcome.accepts, nowMs: waiverNowMs },
  })

  if (!isNewContact) {
    await to(
      admin
        .firestore()
        .collection('contacts')
        .doc(contactId)
        .update({ pending_bookings_count: FieldValue.increment(1) })
    )
  }

  // ── Emails (confirmation + .ics + coach notification) ──
  // Locale-pinned to the studio's language, like the mail it goes into — an
  // unprefixed link opens in the reader's browser language instead.
  const cancelUrl = ctx.teamSlug
    ? localizedPublicUrl(getHostingUrl(), ctx.lang, ctx.teamSlug, 'appointments/cancel', {
        token: bookingToken,
      })
    : null
  await sendAppointmentBookingEmails({
    teamId,
    teamName: ctx.teamName,
    lang: ctx.lang,
    activityName: ctx.activity.name,
    providerId,
    providerName: ctx.providerName,
    start: ctx.start,
    end: ctx.end,
    location: ctx.tpl.location ?? null,
    onlineUrl: ctx.tpl.onlineUrl ?? null,
    cancelUrl,
    bookingId: `${sessionRef.id}-${contactId}`,
    // FREE BY CONSTRUCTION. This callable refuses a payable caller outright
    // (`payment_required` above) — the money rail is createAppointmentCheckout →
    // the Connect webhook, which sends its own confirmation as a receipt. A
    // credit-pack spend also lands here and is NOT counted as paid, exactly as
    // the class free path treats one: `bookingWasPaidFor` reads money and gift
    // cards, and widening it is a decision for the predicate, not for a mailer.
    wasPaidFor: false,
    client: caller.sanitized,
  })

  return { success: true }
})
