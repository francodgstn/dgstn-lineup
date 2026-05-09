import * as admin from 'firebase-admin'

// Initialize Firebase Admin (once)
if (!admin.apps.length) {
  admin.initializeApp()
}

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

// Booking
export { bookTrialSession, sendBookingVerificationCode, verifyBookingCode } from './booking'

// Gamification
export { recalculateScores, resetScores } from './gamification'

// --- Stubs (TODO: port from hmd-lineup) ---
// Booking (remaining)
// export { cancelBooking, rebookSession, getBookingDetails } from './booking'
// Sessions
// export { generateRecurringSessions, updateRecurringSession, cancelSession, generateCoachSlots } from './sessions'
// Contacts
// export { checkInContact, selfCheckIn, deleteContact, restoreContact, moveContacts, generateContactQR } from './contacts'
// Events
// export { sendEventInvitations, handleEventInvitationResponse, getEventInvitationDetails } from './events'
// Analytics
// export { weeklyReports, trackEventAttendees, trackSessionParticipants, generateDashboardInsight } from './analytics'
// Auth / Membership
export { verifyMembershipCode, completeMembershipSignup } from './auth/completeMembershipSignup'
