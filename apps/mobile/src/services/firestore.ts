import { db, getFunctions } from '../config/firebase';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, collectionGroup, orderBy, Timestamp, addDoc, serverTimestamp, limit } from 'firebase/firestore';
import { Contact, TeamPublicProfile, ReferralInfo, AuthToken, SessionPublicProfile, WeeklyReport, ContactAlert, Leaderboard, GamificationSettings, Goal, GoalEvaluation, PerformanceCheckin, PerformanceIndicator, Appointment, AppointmentWithStatus, AvailabilityCoach } from '../types';
import { detectPerformanceProfile } from '../utils/performanceProfile';
import { httpsCallable } from 'firebase/functions';

const DEFAULT_PERFORMANCE_INDICATORS: PerformanceIndicator[] = [
  { key: 'consistency', label: 'Consistency' },
  { key: 'effort', label: 'Effort' },
  { key: 'focus', label: 'Focus' },
  { key: 'recharge', label: 'Recharge' },
  { key: 'sense_of_progress', label: 'Sense of progress' },
];

export const FirestoreService = {
  // Send verification code via existing membership signup function
  async sendVerificationCode(
    email: string,
    teamId?: string
  ): Promise<{
    codeId: string;
    expiresAt: number;
    matchedContacts?: any[];
    teamSummaries?: { id: string; name: string }[] | null;
  }> {
    try {
      const sendContactVerificationCode = httpsCallable(
        getFunctions(),
        'sendContactVerificationCode'
      );

      const payload: { email: string; teamId?: string } = {
        email: email.toLowerCase(),
      };

      if (teamId) {
        payload.teamId = teamId;
      }

      const result = await sendContactVerificationCode(payload);

      return result.data as any;
    } catch (error) {
      console.error('Error sending verification code:', error);
      throw error;
    }
  },

  // Verify code and log in via loginContactWithCode (validates OTP + mints session)
  async verifyCode(codeId: string, code: string, selectedContactId?: string): Promise<{
    verified: boolean;
    email: string;
    requiresSignup?: boolean;
    matchedContacts?: Contact[];
    requiresContactSelection?: boolean;
    customToken?: string | null;
    sessionExpires?: number | null;
    contact?: Contact | null;
    teamSummaries?: { id: string; name: string }[] | null;
  }> {
    try {
      const loginContactWithCode = httpsCallable(getFunctions(), 'loginContactWithCode');

      const result = await loginContactWithCode({
        codeId,
        code,
        selectedContactId,
      });

      const data = result.data as any;

      // loginContactWithCode returns customToken+contact on success,
      // requiresContactSelection for multi-match, or requiresSignup for no match.
      // Map to the shape AuthContext expects.
      if (data.customToken) {
        return { verified: true, email: data.email ?? '', ...data };
      }
      if (data.requiresContactSelection) {
        return { verified: true, email: data.email ?? '', ...data };
      }
      if (data.requiresSignup) {
        return { verified: true, email: data.email ?? '', requiresSignup: true };
      }

      return { verified: false, email: data.email ?? '' };
    } catch (error) {
      console.error('Error verifying code:', error);
      throw error;
    }
  },

  // Get contact profile (requires authenticated session with custom claims)
  async getContact(contactId: string): Promise<Contact | null> {
    try {
      const contactRef = doc(db, 'contacts', contactId);
      const contactSnap = await getDoc(contactRef);

      if (!contactSnap.exists()) {
        return null;
      }

      const data = contactSnap.data();
      return {
        id: contactSnap.id,
        ...data,
        // Normalise legacy contacts: teacher field is the old name for teamId
        teamId: data.teamId || data.teacher || undefined,
      } as Contact;
    } catch (error) {
      console.error('Error fetching contact:', error);
      return null;
    }
  },

  // Get team public profile from the public_profile subcollection
  async getTeamPublicProfile(teamId: string): Promise<TeamPublicProfile | null> {
    try {
      // Access the public_profile subcollection: teams/{teamId}/public_profile/{teamId}
      const publicProfileRef = doc(db, 'teams', teamId, 'public_profile', teamId);
      const profileSnap = await getDoc(publicProfileRef);

      if (!profileSnap.exists()) {
        // Fallback to main team doc for basic info
        const teamRef = doc(db, 'teams', teamId);
        const teamSnap = await getDoc(teamRef);
        if (!teamSnap.exists()) {
          return null;
        }
        const teamData = teamSnap.data();
        return {
          id: teamSnap.id,
          name: teamData.name || '',
          description: teamData.description,
        } as TeamPublicProfile;
      }

      const profileData = profileSnap.data();

      return {
        id: teamId,
        name: profileData.name || '',
        description: profileData.description,
        slug: profileData.slug,
        links: profileData.links || [],
        socialLinks: profileData.socialLinks || [],
        profileImage: profileData.profileImage,
        referralEnabled: profileData.referralEnabled ?? false,
        // The appointments toggle lives in bookingSettings (written by the admin
        // Settings → Booking page) — there is no top-level flag on this doc.
        appointmentsEnabled: profileData.bookingSettings?.appointmentsEnabled ?? false,
      } as TeamPublicProfile;
    } catch (error) {
      console.error('Error fetching team public profile:', error);
      return null;
    }
  },

  async getOrgAffiliationTerm(teamId: string): Promise<string> {
    try {
      const teamSnap = await getDoc(doc(db, 'teams', teamId));
      const orgId = teamSnap.exists() ? (teamSnap.data().org_id as string | undefined) : undefined;
      if (!orgId) return 'Affiliation';

      const orgSnap = await getDoc(doc(db, 'organizations', orgId));
      if (!orgSnap.exists()) return 'Affiliation';

      const termObj = orgSnap.data().affiliation_term as Record<string, string> | undefined;
      if (!termObj) return 'Affiliation';

      // Resolve using device language (first 2 chars of locale, e.g. "de" from "de-CH")
      const locale = (Intl.DateTimeFormat().resolvedOptions().locale ?? 'en').slice(0, 2);
      return termObj[locale] ?? termObj['en'] ?? 'Affiliation';
    } catch {
      return 'Affiliation';
    }
  },

  async getSubscriptionTypeName(teamId: string, subscriptionTypeId: string): Promise<string | null> {
    try {
      const ref = doc(db, 'teams', teamId, 'subscription_types', subscriptionTypeId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const name = snap.data().name || null;
      return name;
    } catch {
      return null;
    }
  },

  // Get all contacts for an email (for managing multiple contacts)
  async getContactsByEmail(email: string): Promise<Contact[]> {
    try {
      const contactsRef = collection(db, 'contacts');
      const q = query(contactsRef, where('email', '==', email.toLowerCase()));
      const querySnapshot = await getDocs(q);

      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Contact));
    } catch (error) {
      console.error('Error fetching contacts by email:', error);
      return [];
    }
  },

  async switchContact(contactId: string): Promise<{
    customToken: string;
    sessionExpires: number;
    contact: Contact;
  } | null> {
    try {
      const switchActiveContact = httpsCallable(
        getFunctions(),
        'switchActiveContact'
      );

      const result = await switchActiveContact({ contactId });

      return result.data as any;
    } catch (error) {
      console.error('Error switching contact:', error);
      return null;
    }
  },

  // Get all active teams for selection on login
  async getActiveTeams(): Promise<TeamPublicProfile[]> {
    try {
      // Query the public_profile subcollection across all teams
      // Structure: teams/{teamId}/public_profile/{docId}
      const publicProfileSnapshot = await getDocs(
        collectionGroup(db, 'public_profile')
      );

      return publicProfileSnapshot.docs
        .filter(doc => {
          // Only include documents from teams collection
          // Path format: teams/{teamId}/public_profile/{docId}
          const pathParts = doc.ref.path.split('/');
          return pathParts[0] === 'teams';
        })
        .map(doc => {
          const profileData = doc.data();
          // Extract teamId from the document path
          const pathParts = doc.ref.path.split('/');
          const teamId = pathParts[1];

          return {
            id: teamId,
            name: profileData.name || 'Team',
            description: profileData.description,
            logo: profileData.logo,
          } as TeamPublicProfile;
        });
    } catch (error) {
      console.error('Error fetching active teams:', error);
      return [];
    }
  },

  // Get QR code data for check-in (calls getContactQR cloud function)
  async getContactQR(): Promise<{
    success: boolean;
    contactId: string;
    hash: string;
    qrData: string;
    contact: {
      firstname: string;
      lastname: string;
      avatar_url: string | null;
    };
  } | null> {
    try {
      const getContactQRFn = httpsCallable(getFunctions(), 'getContactQR');
      const result = await getContactQRFn({});
      return result.data as any;
    } catch (error) {
      console.error('Error getting membership QR:', error);
      return null;
    }
  },

  // Update the weight field on a contact document
  async updateContactWeight(contactId: string, weight: number): Promise<void> {
    const contactRef = doc(db, 'contacts', contactId);
    await updateDoc(contactRef, { weight });
  },

  // Record that the contact was seen (app came to foreground)
  async updateLastSeen(
    contactId: string,
    appVersion?: string,
    extra?: Record<string, unknown>
  ): Promise<void> {
    const contactRef = doc(db, 'contacts', contactId);
    await updateDoc(contactRef, {
      last_seen_at: serverTimestamp(),
      ...(appVersion ? { app_version: appVersion } : {}),
      ...extra,
    });
  },

  // Get upcoming sessions for a team from public_profile subcollection
  async getUpcomingSessions(teamId: string, date: Date = new Date()): Promise<SessionPublicProfile[]> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const upperLimit = new Date(startOfDay);
      upperLimit.setMonth(upperLimit.getMonth() + 3);

      const publicProfileSnapshot = await getDocs(
        query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('doc_type', '==', 'session'),
          where('start', '>=', Timestamp.fromDate(startOfDay)),
          where('start', '<=', Timestamp.fromDate(upperLimit)),
          orderBy('start', 'asc'),
          limit(200)
        )
      );

      const sessions = publicProfileSnapshot.docs
        .map(docSnap => {
          const data = docSnap.data();
          const sessionId = docSnap.ref.path.split('/')[1];

          return {
            id: sessionId,
            activityId: data.activityId,
            activityName: data.activityName || '',
            teamId: data.teamId,
            start: data.start?.toDate?.() || new Date(data.start),
            end: data.end?.toDate?.() || new Date(data.end),
            locationName: data.locationName,
            locationAddress: data.locationAddress,
            locationMapsUrl: data.locationMapsUrl,
            providerName: data.providerName,
            allowBooking: data.allowBooking,
          } as SessionPublicProfile;
        })
        // Sort by start time
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      return sessions;
    } catch (error) {
      console.error('Error fetching upcoming sessions:', error);
      return [];
    }
  },

  // Get attended sessions for a contact within a date range
  async getContactAttendance(
    contactId: string,
    startDate: Date,
    endDate: Date,
    teamId?: string
  ): Promise<SessionPublicProfile[]> {
    try {
      // 1. Query sessions in the date range via public_profile (server-side filtered)
      const constraints = [
        where('teamId', '==', teamId),
        where('doc_type', '==', 'session'),
        where('start', '>=', Timestamp.fromDate(startDate)),
        where('start', '<=', Timestamp.fromDate(endDate)),
        orderBy('start', 'asc')
      ];

      const publicProfileSnapshot = await getDocs(
        query(collectionGroup(db, 'public_profile'), ...constraints)
      );

      // Map to session data
      const potentialSessions = publicProfileSnapshot.docs
        .map(docSnap => {
          const data = docSnap.data();
          const sessionId = docSnap.ref.path.split('/')[1];
          return {
            id: sessionId,
            data: {
              id: sessionId,
              activityId: data.activityId,
              activityName: data.activityName || '',
              teamId: data.teamId,
              start: data.start?.toDate?.() || new Date(data.start),
              end: data.end?.toDate?.() || new Date(data.end),
              locationName: data.locationName,
              locationAddress: data.locationAddress,
              locationMapsUrl: data.locationMapsUrl,
              providerName: data.providerName,
              allowBooking: data.allowBooking,
            } as SessionPublicProfile
          };
        });

      // 2. Check participation for each session in parallel
      const attendedSessions: SessionPublicProfile[] = [];

      await Promise.all(
        potentialSessions.map(async (session) => {
          try {
            const participantRef = doc(db, 'sessions', session.id, 'participants', contactId);
            const participantSnap = await getDoc(participantRef);

            if (participantSnap.exists()) {
              attendedSessions.push(session.data);
            }
          } catch (e) {
            console.warn(`Failed to check participation for session ${session.id}`, e);
          }
        })
      );

      return attendedSessions;
    } catch (error) {
      console.error('Error fetching contact attendance:', error);
      return [];
    }
  },

  // Get all sessions for a team within a date range (available classes)
  async getTeamSessionsInRange(
    teamId: string,
    startDate: Date,
    endDate: Date
  ): Promise<SessionPublicProfile[]> {
    try {
      const publicProfileSnapshot = await getDocs(
        query(
          collectionGroup(db, 'public_profile'),
          where('teamId', '==', teamId),
          where('doc_type', '==', 'session'),
          where('start', '>=', Timestamp.fromDate(startDate)),
          where('start', '<=', Timestamp.fromDate(endDate)),
          orderBy('start', 'asc')
        )
      );

      return publicProfileSnapshot.docs
        .map(docSnap => {
          const data = docSnap.data();
          const sessionId = docSnap.ref.path.split('/')[1];
          return {
            id: sessionId,
            activityId: data.activityId,
            activityName: data.activityName || '',
            teamId: data.teamId,
            start: data.start?.toDate?.() || new Date(data.start),
            end: data.end?.toDate?.() || new Date(data.end),
            locationName: data.locationName,
            locationAddress: data.locationAddress,
            locationMapsUrl: data.locationMapsUrl,
            providerName: data.providerName,
            allowBooking: data.allowBooking,
          } as SessionPublicProfile;
        });
    } catch (error) {
      console.error('Error fetching team sessions in range:', error);
      return [];
    }
  },

  // Get sessions for a team within range and check participation/booking for each
  async getSessionsWithParticipation(
    contactId: string,
    teamId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    try {
      const sessions = await this.getTeamSessionsInRange(teamId, startDate, endDate);
      const now = new Date();

      const sessionsWithStatus = await Promise.all(
        sessions.map(async (session) => {
          let isParticipant = false;
          let isBooked = false;
          try {
            // Check both participants and bookings subcollections
            const [participantSnap, bookingSnap] = await Promise.all([
              getDoc(doc(db, 'sessions', session.id, 'participants', contactId)),
              getDoc(doc(db, 'sessions', session.id, 'bookings', contactId))
            ]);
            isParticipant = participantSnap.exists();
            // Only treat as actively booked if status is 'pending' or absent (legacy)
            const bookingStatus = bookingSnap.exists() ? bookingSnap.data()?.status : null;
            isBooked = bookingSnap.exists() && (!bookingStatus || bookingStatus === 'pending');
          } catch (e) {
            console.warn(`Failed to check participation for session ${session.id}`, e);
          }
          const isPast = session.start < now;

          let status: 'attended' | 'not attended' | 'booked' | 'book';
          if (isParticipant) {
            // In participants = confirmed attendance. Past = attended; future = booked (manually added / promoted).
            status = isPast ? 'attended' : 'booked';
          } else if (isBooked) {
            status = 'booked';
          } else {
            status = isPast ? 'not attended' : 'book';
          }

          return {
            ...session,
            status
          };
        })
      );

      return sessionsWithStatus;
    } catch (error) {
      console.error('Error fetching sessions with participation:', error);
      return [];
    }
  },

  // Get weekly reports for a contact (attendance chart data)
  async getContactWeeklyReports(contactId: string): Promise<WeeklyReport[]> {
    try {
      const reportsRef = collection(db, 'contacts', contactId, 'contact_weekly_reports');
      const q = query(reportsRef, orderBy('iso_week', 'asc'));
      const snapshot = await getDocs(q);

      return snapshot.docs.map(doc => ({
        id: doc.id,
        iso_week: doc.data().iso_week,
        sessions_count: doc.data().sessions_count || 0,
      }));
    } catch (error) {
      console.error('Error fetching weekly reports:', error);
      return [];
    }
  },

  // Get team leaderboard (denormalized document for gamification)
  async getTeamLeaderboard(teamId: string): Promise<Leaderboard | null> {
    try {
      const leaderboardRef = doc(db, 'teams', teamId, 'leaderboard', 'current');
      const leaderboardSnap = await getDoc(leaderboardRef);

      if (!leaderboardSnap.exists()) {
        return null;
      }

      const data = leaderboardSnap.data();
      return {
        month: data.month,
        entries: data.entries || [],
        entries_count: data.entries_count || 0,
        updated_at: data.updated_at?.toDate?.() || new Date(),
      } as Leaderboard;
    } catch (error) {
      console.error('Error fetching team leaderboard:', error);
      return null;
    }
  },

  // Get gamification settings (badge thresholds + coach badges) from team config
  async getTeamGamificationSettings(teamId: string): Promise<GamificationSettings | null> {
    try {
      const teamRef = doc(db, 'teams', teamId);
      const teamSnap = await getDoc(teamRef);
      if (!teamSnap.exists()) return null;
      const gamification = teamSnap.data()?.settings?.gamification;
      if (!gamification) return null;
      return {
        badge_thresholds: gamification.badge_thresholds || null,
        coach_badges: gamification.coach_badges || null,
      };
    } catch (error) {
      console.error('Error fetching gamification settings:', error);
      return null;
    }
  },

  // Get active alerts for a contact (alerts with show_in_app=true and not archived)
  async getContactAlerts(contactId: string): Promise<ContactAlert[]> {
    try {
      const alertsRef = collection(db, 'contacts', contactId, 'contact_alerts');
      const q = query(
        alertsRef,
        where('show_in_app', '==', true),
        where('archived_at', '==', null),
        orderBy('created_at', 'desc')
      );
      const snapshot = await getDocs(q);

      const now = new Date();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

      return snapshot.docs
        .map(doc => {
          const data = doc.data();
          const scheduleValue = data.schedule?.value;
          let parsedValue: number | Date;

          if (data.schedule?.type === 'datetime') {
            // Convert Firestore Timestamp to Date
            parsedValue = scheduleValue?.toDate?.() || new Date(scheduleValue);
          } else {
            // sessions_countdown - value is a number
            parsedValue = scheduleValue;
          }

          return {
            id: doc.id,
            message: data.message || '',
            schedule: {
              type: data.schedule?.type || 'datetime',
              value: parsedValue,
            },
            alert_type: data.alert_type,
            show_in_app: data.show_in_app,
            created_at: data.created_at?.toDate?.() || new Date(data.created_at),
            archived_at: data.archived_at ? (data.archived_at?.toDate?.() || new Date(data.archived_at)) : null,
          } as ContactAlert;
        })
        .filter(alert => {
          // Filter based on schedule type
          if (alert.schedule.type === 'sessions_countdown') {
            // Show when value <= 1 (1 or fewer sessions remaining)
            return (alert.schedule.value as number) <= 1;
          } else {
            // datetime: show 1 week before and after the scheduled date
            const scheduledDate = alert.schedule.value as Date;
            const diff = scheduledDate.getTime() - now.getTime();
            return diff >= -oneWeekMs && diff <= oneWeekMs;
          }
        });
    } catch (error) {
      console.error('Error fetching contact alerts:', error);
      return [];
    }
  },

  // Request contact update via cloud function. Like bookSession, the signed-in
  // contact session rides along on the callable and identifies us server-side.
  async requestContactUpdate(params: {
    contactDetails: Partial<Contact>;
    note?: string;
  }): Promise<{ success: boolean; requestId: string }> {
    try {
      const requestContactUpdateFn = httpsCallable(getFunctions(), 'requestContactUpdate');
      const result = await requestContactUpdateFn(params);
      return result.data as any;
    } catch (error) {
      console.error('Error requesting contact update:', error);
      throw error;
    }
  },

  // Book a session as the signed-in contact. No token dance: our contact session
  // (the custom token minted at login) rides along on the callable automatically,
  // and bookSession reads contactId/teamId from its claims — so the booking is
  // always stored under the contact's own ID (required for cancellation to work).
  async bookSession(params: {
    teamId: string;
    sessionId: string;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      const bookSessionFn = httpsCallable(getFunctions(), 'bookSession');
      const result = await bookSessionFn({
        teamId: params.teamId,
        sessionId: params.sessionId,
      });
      return result.data as any;
    } catch (error) {
      console.error('Error booking session:', error);
      throw error;
    }
  },

  // Get booked sessions for a contact within a date range (from bookings subcollection)
  async getContactBookings(
    contactId: string,
    startDate: Date,
    endDate: Date,
    teamId?: string
  ): Promise<SessionPublicProfile[]> {
    try {
      // Same approach as getContactAttendance but checking bookings instead of participants
      const constraints = [
        where('teamId', '==', teamId),
        where('doc_type', '==', 'session'),
        where('start', '>=', Timestamp.fromDate(startDate)),
        where('start', '<=', Timestamp.fromDate(endDate)),
        orderBy('start', 'asc')
      ];

      const publicProfileSnapshot = await getDocs(
        query(collectionGroup(db, 'public_profile'), ...constraints)
      );

      const potentialSessions = publicProfileSnapshot.docs
        .map(docSnap => {
          const data = docSnap.data();
          const sessionId = docSnap.ref.path.split('/')[1];
          return {
            id: sessionId,
            data: {
              id: sessionId,
              activityId: data.activityId,
              activityName: data.activityName || '',
              teamId: data.teamId,
              start: data.start?.toDate?.() || new Date(data.start),
              end: data.end?.toDate?.() || new Date(data.end),
              locationName: data.locationName,
              locationAddress: data.locationAddress,
              locationMapsUrl: data.locationMapsUrl,
              providerName: data.providerName,
              allowBooking: data.allowBooking,
            } as SessionPublicProfile
          };
        });

      const bookedSessions: SessionPublicProfile[] = [];

      await Promise.all(
        potentialSessions.map(async (session) => {
          try {
            const bookingRef = doc(db, 'sessions', session.id, 'bookings', contactId);
            const bookingSnap = await getDoc(bookingRef);

            if (bookingSnap.exists()) {
              const bookingStatus = bookingSnap.data()?.status;
              // Only include pending bookings (or legacy docs without status field)
              if (!bookingStatus || bookingStatus === 'pending') {
                bookedSessions.push(session.data);
              }
            }
          } catch (e) {
            console.warn(`Failed to check booking for session ${session.id}`, e);
          }
        })
      );

      return bookedSessions;
    } catch (error) {
      console.error('Error fetching contact bookings:', error);
      return [];
    }
  },

  // Cancel a session booking (requires fetching token from bookings subcollection)
  async cancelSession(params: {
    sessionId: string;
    contactId: string;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      console.log('[cancelSession] Starting cancel for session:', params.sessionId, 'contact:', params.contactId);

      // 1. Get booking doc to find the booking token (check bookings first, fall back to participants for pre-migration data)
      const bookingRef = doc(db, 'sessions', params.sessionId, 'bookings', params.contactId);
      let bookingSnap = await getDoc(bookingRef);
      console.log('[cancelSession] Booking doc exists:', bookingSnap.exists());

      if (!bookingSnap.exists()) {
        // Fallback: check participants for bookings not yet migrated
        const participantRef = doc(db, 'sessions', params.sessionId, 'participants', params.contactId);
        bookingSnap = await getDoc(participantRef);
        console.log('[cancelSession] Participant fallback exists:', bookingSnap.exists());
      }

      if (!bookingSnap.exists()) {
        throw new Error('Booking not found');
      }

      const bookingData = bookingSnap.data();
      const bookingStatus = bookingData?.status;
      if (bookingStatus && bookingStatus !== 'pending') {
        throw new Error('This booking can no longer be cancelled.');
      }

      const bookingToken = bookingData?.booking_token;
      console.log('[cancelSession] Has booking_token:', !!bookingToken);

      if (!bookingToken) {
        throw new Error('No booking token found for this session');
      }

      // 2. Call cancelBooking with the token
      console.log('[cancelSession] Calling cancelBooking cloud function...');
      const cancelBookingFn = httpsCallable(getFunctions(), 'cancelBooking');
      const result = await cancelBookingFn({ token: bookingToken });
      console.log('[cancelSession] Cloud function result:', result.data);

      return result.data as any;
    } catch (error) {
      console.error('[cancelSession] Error:', error);
      throw error;
    }
  },

  // Self check-in via team QR code scan.
  // teamSlug: from the scanned QR ({"team":"<slug>"})
  // sessionId: optional — if omitted the function resolves active sessions automatically
  async selfCheckIn(params: {
    teamSlug: string;
    sessionId?: string;
  }): Promise<
    | { status: 'checked_in'; alreadyCheckedIn: boolean; sessionName: string; sessionStart: number }
    | { status: 'session_required'; sessions: Array<{ id: string; activityName: string; start: any; end: any }> }
    | { status: 'no_sessions' }
  > {
    const fn = httpsCallable(getFunctions(), 'selfCheckIn');
    const result = await fn(params);
    return result.data as any;
  },

  // Get the authenticated student's personal referral code and shareable URL
  async getMyReferralCode(): Promise<ReferralInfo | null> {
    try {
      const fn = httpsCallable(getFunctions(), 'getMyReferralCode');
      const result = await fn({});
      return result.data as ReferralInfo;
    } catch (error) {
      console.error('Error getting referral code:', error);
      return null;
    }
  },

  // Get the count of rewards received by the authenticated student
  async getMyReferralStats(): Promise<{ rewarded_count: number }> {
    try {
      const fn = httpsCallable(getFunctions(), 'getMyReferralStats');
      const result = await fn({});
      return result.data as { rewarded_count: number };
    } catch (error) {
      console.error('Error getting referral stats:', error);
      return { rewarded_count: 0 };
    }
  },

  // Goals

  async getGoals(contactId: string): Promise<Goal[]> {
    try {
      const goalsRef = collection(db, 'contacts', contactId, 'goals');
      const q = query(goalsRef, orderBy('created_at', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
      } as Goal));
    } catch (error) {
      console.error('Error fetching goals:', error);
      return [];
    }
  },

  async updateGoal(contactId: string, goalId: string, data: Partial<Omit<Goal, 'id'>>): Promise<void> {
    try {
      const goalRef = doc(db, 'contacts', contactId, 'goals', goalId);
      await updateDoc(goalRef, data as any);
    } catch (error) {
      console.error('Error updating goal:', error);
      throw error;
    }
  },

  async deleteGoal(contactId: string, goalId: string): Promise<void> {
    try {
      const goalRef = doc(db, 'contacts', contactId, 'goals', goalId);
      await deleteDoc(goalRef);
    } catch (error) {
      console.error('Error deleting goal:', error);
      throw error;
    }
  },

  async createGoal(contactId: string, data: Omit<Goal, 'id'>): Promise<string> {
    try {
      const goalsRef = collection(db, 'contacts', contactId, 'goals');
      const docRef = await addDoc(goalsRef, data);
      return docRef.id;
    } catch (error) {
      console.error('Error creating goal:', error);
      throw error;
    }
  },

  async getGoalEvaluations(contactId: string, goalId: string): Promise<GoalEvaluation[]> {
    try {
      const evalsRef = collection(db, 'contacts', contactId, 'goals', goalId, 'evaluations');
      const q = query(evalsRef, orderBy('evaluated_at', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
      } as GoalEvaluation));
    } catch (error) {
      console.error('Error fetching goal evaluations:', error);
      return [];
    }
  },

  async addGoalEvaluation(contactId: string, goalId: string, data: Omit<GoalEvaluation, 'id'>): Promise<void> {
    try {
      const evalsRef = collection(db, 'contacts', contactId, 'goals', goalId, 'evaluations');
      await addDoc(evalsRef, data);
      const goalRef = doc(db, 'contacts', contactId, 'goals', goalId);
      await updateDoc(goalRef, { status: data.status_after });
    } catch (error) {
      console.error('Error adding goal evaluation:', error);
      throw error;
    }
  },

  async updateGoalEvaluation(contactId: string, goalId: string, evalId: string, data: Partial<Omit<GoalEvaluation, 'id'>>): Promise<void> {
    try {
      const evalRef = doc(db, 'contacts', contactId, 'goals', goalId, 'evaluations', evalId);
      await updateDoc(evalRef, { ...data, edited: true });
      if (data.status_after) {
        const goalRef = doc(db, 'contacts', contactId, 'goals', goalId);
        await updateDoc(goalRef, { status: data.status_after });
      }
    } catch (error) {
      console.error('Error updating goal evaluation:', error);
      throw error;
    }
  },

  // Performance check-ins

  async getPerformanceCheckins(contactId: string, limitCount: number = 10): Promise<PerformanceCheckin[]> {
    try {
      const checkinsRef = collection(db, 'contacts', contactId, 'performance_checkins');
      const q = query(checkinsRef, orderBy('taken_at', 'desc'), limit(limitCount));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
      } as PerformanceCheckin));
    } catch (error) {
      console.error('Error fetching performance check-ins:', error);
      return [];
    }
  },

  async addPerformanceCheckin(contactId: string, data: Omit<PerformanceCheckin, 'id'>): Promise<void> {
    try {
      const checkinsRef = collection(db, 'contacts', contactId, 'performance_checkins');

      const profile = detectPerformanceProfile(data.scores);
      const payload = { ...data, ...profile };

      // Enforce one-per-day per author: overwrite if exists
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const existingQ = query(
        checkinsRef,
        where('filled_by', '==', data.filled_by),
        where('taken_at', '>=', Timestamp.fromDate(todayStart)),
        where('taken_at', '<=', Timestamp.fromDate(todayEnd)),
        limit(1)
      );
      const existingSnap = await getDocs(existingQ);

      if (!existingSnap.empty) {
        const existingDocRef = doc(db, 'contacts', contactId, 'performance_checkins', existingSnap.docs[0].id);
        await updateDoc(existingDocRef, { ...payload });
        return;
      }

      await addDoc(checkinsRef, payload);
    } catch (error) {
      console.error('Error adding performance check-in:', error);
      throw error;
    }
  },

  async getTeamPerformanceIndicators(teamId: string): Promise<PerformanceIndicator[]> {
    try {
      const teamRef = doc(db, 'teams', teamId);
      const teamSnap = await getDoc(teamRef);
      if (!teamSnap.exists()) return DEFAULT_PERFORMANCE_INDICATORS;
      const indicators = teamSnap.data()?.performance_indicators;
      if (Array.isArray(indicators) && indicators.length > 0) {
        return indicators as PerformanceIndicator[];
      }
      return DEFAULT_PERFORMANCE_INDICATORS;
    } catch (error) {
      console.error('Error fetching team performance indicators:', error);
      return DEFAULT_PERFORMANCE_INDICATORS;
    }
  },

  async getTeamGoalCategories(teamId: string): Promise<PerformanceIndicator[] | null> {
    try {
      const teamRef = doc(db, 'teams', teamId);
      const teamSnap = await getDoc(teamRef);
      if (!teamSnap.exists()) return null;
      const categories = teamSnap.data()?.goal_categories;
      if (Array.isArray(categories) && categories.length > 0) {
        return categories as PerformanceIndicator[];
      }
      return null;
    } catch (error) {
      console.error('Error fetching team goal categories:', error);
      return null;
    }
  },

  // ── Appointments (backed by sessions with activityType === 'appointment') ────

  /**
   * The contact's OWN upcoming booked appointments.
   *
   * Appointments are availability-only: a provider publishes free time
   * (`availability` docs) and NOTHING is pre-generated — an appointment session is
   * created only when someone books. So every session this query returns is
   * already booked by someone; we keep only the ones booked by THIS contact
   * (other members' appointments are none of their business, and there are no
   * "open" slots left to browse).
   */
  async getUpcomingAppointments(
    teamId: string,
    contactId: string
  ): Promise<AppointmentWithStatus[]> {
    try {
      const now = Timestamp.now();
      const slotsQuery = query(
        collection(db, 'sessions'),
        where('teamId', '==', teamId),
        where('activityType', '==', 'appointment'),
        where('start', '>=', now),
        orderBy('start', 'asc'),
        limit(20)
      );

      const slotsSnap = await getDocs(slotsQuery);
      const slots = slotsSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          teamId: data.teamId,
          templateId: data.templateId || null,
          providerId: data.providerId || '',
          providerName: data.providerName || '',
          activityName: data.activityName || '',
          start: data.start?.toDate?.() || new Date(),
          end: data.end?.toDate?.() || new Date(),
          max_participants: data.max_participants || 1,
          // ONE counter for classes and appointments alike: bookings HOLDING
          // CAPACITY (status neither 'cancelled' nor 'no_show'). The separate
          // bio-link counter classes used to count into was merged into this one.
          bookings_count: data.bookings_count || 0,
          location: data.location || null,
          // An absent status means nobody has booked yet → 'open'.
          status: data.status || 'open',
        } as Appointment;
      });

      // For each slot check if the contact has a confirmed/pending booking
      const results: AppointmentWithStatus[] = await Promise.all(
        slots.map(async (slot) => {
          let bookingStatus: AppointmentWithStatus['bookingStatus'] = 'available';
          if (slot.status === 'cancelled') {
            bookingStatus = 'cancelled';
          } else {
            try {
              const bookingRef = doc(db, 'sessions', slot.id, 'bookings', contactId);
              const bookingSnap = await getDoc(bookingRef);
              if (bookingSnap.exists()) {
                const bStatus = bookingSnap.data()?.status;
                if (bStatus === 'confirmed' || bStatus === 'pending' || !bStatus) {
                  bookingStatus = 'booked';
                }
              } else if (slot.status === 'full') {
                bookingStatus = 'full';
              }
            } catch {
              if (slot.status === 'full') bookingStatus = 'full';
            }
          }
          return { ...slot, bookingStatus };
        })
      );

      // Only the contact's own bookings — see the doc comment above.
      return results.filter((r) => r.bookingStatus === 'booked');
    } catch (error) {
      console.error('Error fetching appointments:', error);
      return [];
    }
  },

  /**
   * The team's PUBLISHED availability — the *when* — grouped coach-first, with
   * each coach's bookable `type: 'appointment'` activities and their free start
   * times per day/duration. Pure read, no writes; mirrors the public web picker
   * at /public/{slug}/appointments. See `listAvailability` in
   * packages/functions/src/appointments/window.ts.
   */
  async listAppointmentAvailability(teamId: string, days: number = 60): Promise<AvailabilityCoach[]> {
    const listAvailabilityFn = httpsCallable(getFunctions(), 'listAvailability');
    const result = await listAvailabilityFn({ teamId, days });
    return (result.data as { coaches: AvailabilityCoach[] })?.coaches ?? [];
  },

  /**
   * Book a specific start time from published availability. The caller's
   * identity comes from the signed-in contact SESSION — the custom-token claims
   * (contactId/teamId/sessionExpires) that `httpsCallable` automatically attaches
   * as `request.auth` once the student is signed in (see AuthContext). No OTP /
   * email step is needed: `bookAppointment` trusts `request.auth.token.contactId`
   * as a first-class authenticated path (see
   * packages/functions/src/appointments/window.ts).
   */
  async bookAppointment(params: {
    teamId: string;
    providerId: string;
    activityId: string;
    startMs: number;
    durationMinutes: number;
  }): Promise<{ success: boolean }> {
    const bookAppointmentFn = httpsCallable(getFunctions(), 'bookAppointment');
    const result = await bookAppointmentFn(params);
    return result.data as { success: boolean };
  },

  // Cancel an appointment booking — delegates to the unified cancelSession logic
  async cancelAppointment(params: {
    slotId: string;
    contactId: string;
  }): Promise<{ success: boolean }> {
    return this.cancelSession({ sessionId: params.slotId, contactId: params.contactId });
  },
};
