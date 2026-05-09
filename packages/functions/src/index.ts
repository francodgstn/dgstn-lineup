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
export { bookTrialSession, sendBookingVerificationCode, verifyBookingCode, cancelBooking } from './booking'

// Gamification
export { recalculateScores, resetScores } from './gamification'

// Sessions
export { generateRecurringSessions, cancelSession } from './sessions'

// Contacts
export { deleteContact, restoreContact, checkInContact } from './contacts'

// Auth / Membership
export { verifyMembershipCode, completeMembershipSignup } from './auth/completeMembershipSignup'

// --- Stubs (TODO: port from hmd-lineup) ---
// export { rebookSession, getBookingDetails } from './booking'
// export { updateRecurringSession, generateCoachSlots } from './sessions'
// export { selfCheckIn, moveContacts, generateContactQR } from './contacts'
// export { sendEventInvitations, handleEventInvitationResponse, getEventInvitationDetails } from './events'
// export { weeklyReports, trackEventAttendees, trackSessionParticipants, generateDashboardInsight } from './analytics'
