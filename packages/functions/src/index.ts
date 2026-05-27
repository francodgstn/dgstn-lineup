import * as admin from 'firebase-admin'
import { setGlobalOptions } from 'firebase-functions/v2'

// Initialize Firebase Admin (once)
if (!admin.apps.length) {
  admin.initializeApp()
}

// Set region once — individual modules must NOT call setGlobalOptions
setGlobalOptions({ region: 'europe-west6' })

// Teams
export { createTeam } from './teams/createTeam'
export { validateTeamSlug } from './teams/validateTeamSlug'
export { sendTeamInvitation } from './teams/sendTeamInvitation'
export { getTeamInvitationDetails } from './teams/getTeamInvitationDetails'
export { acceptTeamInvitation } from './teams/acceptTeamInvitation'

// Auth
export { generateAuthToken } from './auth/generateAuthToken'
export { sendMembershipVerificationCode } from './auth/sendMembershipVerificationCode'

// Sync triggers
export { syncTeamPublicProfile } from './sync/syncTeamPublicProfile'
export { syncSessionPublicProfile } from './sync/syncSessionPublicProfile'
export { syncActivityPublicProfile } from './sync/syncActivityPublicProfile'
export { indexUser } from './sync/indexUser'
export { syncSubscriptionTypesToPublicProfile } from './sync/syncSubscriptionTypesToPublicProfile'
export { onContactSubscriptionChange } from './sync/onContactSubscriptionChange'
export { onSessionUpdate } from './sync/onSessionUpdate'

// Booking
export { bookSession, sendBookingVerificationCode, verifyBookingCode, cancelBooking, getBookingDetails, rebookSession } from './booking'

// Gamification
export { recalculateScores, resetScores } from './gamification'

// Sessions
export { generateRecurringSessions, cancelSession, updateRecurringSession, selfCheckIn } from './sessions'

// Contacts
export { deleteContact, restoreContact, checkInContact, moveContacts } from './contacts'

// Events
export { sendEventInvitations, getEventInvitationDetails, handleEventInvitationResponse } from './events'

// Analytics
export { trackBookings, trackSessions, weeklyReports, trackContacts, trackSessionParticipants } from './analytics'

// Daily maintenance tasks
export { dailyTasks } from './dailyTasks'

// Auth / Membership
export { verifyMembershipCode, completeMembershipSignup } from './auth/completeMembershipSignup'

// Coaching (1:1 slots)
export { generateCoachSlots, generateCoachSlotsScheduled, bookCoachSlot, cancelCoachBooking, trackCoachBookings } from './coaching'

// SaaS billing
export { createCheckoutSession, handleStripeWebhook, cancelSaasSubscription, getSaasInvoices } from './saas-billing'

// --- Stubs (TODO: port from hmd-lineup) ---
// export { generateContactQR } from './contacts'
// export { generateDashboardInsight } from './analytics'
