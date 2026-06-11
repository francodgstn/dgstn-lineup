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
export { manageTeamInvitation } from './teams/manageTeamInvitation'
export { manageTeamMember } from './teams/manageTeamMember'

// Auth
export { generateAuthToken } from './auth/generateAuthToken'
export { sendMembershipVerificationCode } from './auth/sendMembershipVerificationCode'
export { validateAuthToken } from './auth/validateAuthToken'
export { generateApiKey } from './auth/generateApiKey'

// Sync triggers
export { syncTeamPublicProfile } from './sync/syncTeamPublicProfile'
export { syncSessionPublicProfile } from './sync/syncSessionPublicProfile'
export { syncActivityPublicProfile } from './sync/syncActivityPublicProfile'
export { indexUser } from './sync/indexUser'
export { syncSubscriptionTypesToPublicProfile } from './sync/syncSubscriptionTypesToPublicProfile'
export { onContactSubscriptionChange } from './sync/onContactSubscriptionChange'
export { onSessionUpdate } from './sync/onSessionUpdate'
export { onActivityTypeChange } from './sync/onActivityTypeChange'

// Booking
export { bookSession, sendBookingVerificationCode, verifyBookingCode, cancelBooking, getBookingDetails, rebookSession } from './booking'

// Gamification
export { recalculateScores, resetScores } from './gamification'
export { triggerScoresRebuild } from './gamification/triggerScoresRebuild'
export { processScoresRebuildJob } from './gamification/processScoresRebuildJob'
export { recalculateScoresFromDate } from './gamification/recalculateScoresFromDate'

// Sessions
export { generateRecurringSessions, cancelSession, updateRecurringSession, selfCheckIn } from './sessions'
export { setSessionLocation } from './sessions/setSessionLocation'
export { setSessionTags } from './sessions/setSessionTags'

// Contacts
export { deleteContact, restoreContact, checkInContact, moveContacts } from './contacts'
export { generateContactQR } from './contacts/generateContactQR'
export { getMembershipQR } from './contacts/getMembershipQR'
export { requestContactUpdate } from './contacts/requestContactUpdate'
export { manageContactUpdateRequest } from './contacts/manageContactUpdateRequest'
export { switchMembershipContact } from './contacts/switchMembershipContact'

// Events
export { sendEventInvitations, getEventInvitationDetails, handleEventInvitationResponse } from './events'
export { trackEventAttendees } from './events/trackEventAttendees'
export { addEventCheckin } from './events/addEventCheckin'

// Analytics
export { trackBookings, trackSessions, weeklyReports, trackContacts, trackSessionParticipants } from './analytics'
export { capturePlatformMetrics } from './analytics/platformMetrics'

// Daily maintenance tasks
export { dailyTasks } from './dailyTasks'

// Auth / Membership
export { verifyMembershipCode, completeMembershipSignup } from './auth/completeMembershipSignup'

// Coaching (1:1 slots) — booking/cancellation handled by bookSession/cancelBooking
export { generateCoachSlots, generateCoachSlotsScheduled, onCoachAvailabilityWritten } from './coaching'

// SaaS billing (Linyup's own platform subscriptions — Stripe)
export { createCheckoutSession, handleStripeWebhook, cancelSaasSubscription, getSaasInvoices, reactivateSaasSubscription, getBillingPortalUrl, activatePluginAddon, deactivatePluginAddon, syncContactOverage, extendTrial, handleTrialLifecycle } from './saas-billing'

// Organizations (multi-team tier)
export {
  createOrganization,
  inviteTeamToOrg,
  acceptOrgInvitation,
  declineOrgInvitation,
  removeTeamFromOrg,
  createOrgCheckoutSession,
  getOrgInvitationDetails,
  requestTeamAccess,
} from './orgs'

// Team-level billing (teams charging their own students — Payrexx)
export { handlePayrexxWebhook } from './billing/handlePayrexxWebhook'

// SMTP configuration (team / org-level outbound email settings)
export { saveSmtpConfig, testSmtpConfig } from './smtp-settings'

// Outreach
export { sendOutreachEmail } from './outreach'

// Referrals
export { generateReferralCodes, confirmReferral, getMyReferralCode, getMyReferralStats } from './referrals'

// Portal
export { getInTouchForm } from './portal/getInTouchForm'

// Automation engine (Phase 1–3: scheduled, manual callables, event triggers, delayed via Cloud Tasks)
export {
  triggerAutomationRule,
  previewAutomationRule,
  onContactWrite,
  onBookingWrite,
  onSessionWrite,
  executeDelayedRule,
  inboundWebhook,
} from './automation'

// --- Stubs (TODO: port from hmd-lineup) ---
// export { generateDashboardInsight } from './analytics'
