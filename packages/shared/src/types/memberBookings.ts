// The contract of `getMyBookings` — the signed-in contact's own upcoming
// bookings, as the member portal renders them.
//
// It lives in `@linyup/shared` because BOTH ends of the wire are in this repo
// and the failure this callable exists to fix was a silent mismatch between
// them: the Space listed the team's public session mirrors with
// `type == 'session'`, appointments are mirrored as `type == 'appointment_session'`,
// so a member holding a paid appointment was told "You have no upcoming
// bookings." A shape both sides compile against is the cheapest guard there is
// against the next version of that.
//
// Everything here is already the caller's own data — her booking, on a session
// she is in. `cancelToken` is the `booking_token` from HER booking document,
// which she was also mailed; it is the credential `cancelBooking` takes, and it
// is returned ONLY when cancelling is actually still allowed (see `cancellable`).

/** Which scheduling primitive this booking sits on — `Session.activityType`.
 *  A class is a seat in a scheduled event; an appointment is a provider's
 *  exclusive time, and is the kind the member surface must name a provider for. */
export type MyBookingKind = 'class' | 'appointment'

/** One upcoming booking of the signed-in contact. Times are ISO-8601 strings
 *  (a callable response is JSON — a Firestore Timestamp does not survive it). */
export interface MyBooking {
  /** The session the booking is on. Unique per contact: a booking document's id
   *  IS the contactId, so one contact holds at most one booking per session —
   *  which is what makes this a safe React key and a safe merge key for paging. */
  sessionId: string
  kind: MyBookingKind
  activityName: string | null
  start: string | null
  end: string | null
  location: string | null
  /** Set for online sessions (appointments carry it today). */
  onlineUrl: string | null
  /** The coach/provider. Always shown for an appointment — it is the one thing
   *  that distinguishes two otherwise identical slots. */
  providerName: string | null
  /** The booking document's own status (`pending` / `confirmed` / …), or null
   *  when it carries none — an absent status reads as pending everywhere. */
  status: string | null
  /**
   * Is `cancelBooking` still going to accept this? Resolved server-side against
   * the SAME rules that callable applies (a live token, a session that has not
   * started, a status the session's auto-confirm setting still treats as
   * cancellable) so the button is never offered for a call that will refuse.
   */
  cancellable: boolean
  /** The `booking_token` for `cancelBooking`, or null when `cancellable` is false. */
  cancelToken: string | null
  /** The studio called this session off (either cancellation shape — a status
   *  flip, or a cancelled occurrence of a recurring series). The row stays
   *  visible, because a class silently disappearing from her list is exactly
   *  the sort of thing she would read as "my booking was lost". */
  sessionCancelled: boolean
}

export interface MyBookingsResult {
  /** Upcoming only, soonest first. */
  bookings: MyBooking[]
  /**
   * Continue the walk back through her reservation history, or null when the
   * server reached the end of it.
   *
   * The scan is bounded by HER OWN most recently made reservations, never by
   * the team's volume — a busy studio cannot push her bookings out of view.
   * The value is the `joinedAt` of the last document scanned, in epoch ms, and
   * the next page is INCLUSIVE of it: re-reading one boundary document is much
   * cheaper than skipping one when two reservations share a millisecond.
   * Callers must therefore de-duplicate by `sessionId` when merging pages, and
   * must stop when a page returns the cursor they sent.
   */
  cursor: number | null
  /** How many of her booking documents this call actually read. The client does
   *  not render it; it exists so the cost of this surface is observable. */
  scanned: number
}
