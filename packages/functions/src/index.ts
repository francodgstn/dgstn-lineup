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
export { onTeamCreated } from './teams/onTeamCreated'
export { validateTeamSlug } from './teams/validateTeamSlug'
export { sendTeamInvitation } from './teams/sendTeamInvitation'
export { getTeamInvitationDetails } from './teams/getTeamInvitationDetails'
export { acceptTeamInvitation } from './teams/acceptTeamInvitation'
export { manageTeamInvitation } from './teams/manageTeamInvitation'
export { manageTeamMember } from './teams/manageTeamMember'
export { listTeamMembers } from './teams/listTeamMembers'

// Auth
export { generateAuthToken } from './auth/generateAuthToken'
export { sendContactVerificationCode } from './auth/sendContactVerificationCode'
export { validateAuthToken } from './auth/validateAuthToken'
export { generateApiKey } from './auth/generateApiKey'

// Signup gating (limited launch) — blocking function + invite email trigger
export { beforeSignup } from './auth/beforeSignup'
export { onSignupInviteCreated } from './auth/onSignupInviteCreated'

// Affiliations
export { upsertAffiliation, removeAffiliation, approveAffiliation, renewAffiliation } from './affiliations'

// Sync triggers
export { syncTeamPublicProfile } from './sync/syncTeamPublicProfile'
export { syncSessionPublicProfile } from './sync/syncSessionPublicProfile'
export { syncActivityPublicProfile } from './sync/syncActivityPublicProfile'
export { syncCoursePublicProfile } from './sync/syncCoursePublicProfile'
export { syncFormPublicProfile } from './sync/syncFormPublicProfile'
export { syncDocumentPublicProfile } from './sync/syncDocumentPublicProfile'
export { indexUser } from './sync/indexUser'
export { syncSubscriptionTypesToPublicProfile } from './sync/syncSubscriptionTypesToPublicProfile'
export { syncProductsToPublicProfile } from './sync/syncProductsToPublicProfile'
export { syncMemberCapabilities } from './sync/syncMemberCapabilities'
export { syncPrimaryPlaceToPublicProfile } from './sync/syncPrimaryPlaceToPublicProfile'
export { syncTeamCoachesPublicProfile } from './sync/syncTeamCoachesPublicProfile'
export { onContactSubscriptionChange } from './sync/onContactSubscriptionChange'
export { onMemberSubscriptionWrite } from './sync/onMemberSubscriptionWrite'
export { onSessionUpdate } from './sync/onSessionUpdate'
export { onActivityTypeChange } from './sync/onActivityTypeChange'
export { onInstalledPluginStatusChange } from './sync/onInstalledPluginStatusChange'
export { onAffiliationWrite } from './sync/onAffiliationWrite'
export { onCreditGrantWrite } from './sync/onCreditGrantWrite'

// Booking
export {
  bookSession,
  sendBookingVerificationCode,
  verifyBookingCode,
  cancelBooking,
  getBookingDetails,
  rebookSession,
} from './booking'
export { createDropInCheckout } from './booking/dropIn'

// Gamification
export { recalculateScores, resetScores } from './gamification'
export { triggerScoresRebuild } from './gamification/triggerScoresRebuild'
export { processScoresRebuildJob } from './gamification/processScoresRebuildJob'
export { recalculateScoresFromDate } from './gamification/recalculateScoresFromDate'

// Sessions
export {
  generateRecurringSessions,
  cancelSession,
  updateRecurringSession,
  selfCheckIn,
} from './sessions'
export { setSessionLocation } from './sessions/setSessionLocation'
export { setSessionTags } from './sessions/setSessionTags'

// Contacts
export { deleteContact, restoreContact, checkInContact, moveContacts } from './contacts'
export { generateContactQR } from './contacts/generateContactQR'
export { getContactQR } from './contacts/getContactQR'
export { requestContactUpdate } from './contacts/requestContactUpdate'
export { grantCredits } from './contacts/grantCredits'
export { manageContactUpdateRequest } from './contacts/manageContactUpdateRequest'
export { switchActiveContact } from './contacts/switchActiveContact'
export { listMyContactPayments, createContactBillingPortalSession } from './contacts/contactPayments'

// Events
export {
  sendEventInvitations,
  getEventInvitationDetails,
  handleEventInvitationResponse,
} from './events'
export { trackEventAttendees } from './events/trackEventAttendees'
export { addEventCheckin } from './events/addEventCheckin'

// Analytics
export {
  trackBookings,
  trackSessions,
  weeklyReports,
  trackContacts,
  trackSessionParticipants,
} from './analytics'
export { capturePlatformMetrics } from './analytics/platformMetrics'

// Daily maintenance tasks + the hourly multi-step booking-reminder scan
export { dailyTasks, bookingRemindersHourly } from './dailyTasks'

// Auth / Membership
export { verifyContactCode, completeSignup } from './auth/completeSignup'
export { loginContactWithCode } from './auth/loginContactWithCode'

// Coaching (1:1 slots) — booking/cancellation handled by bookSession/cancelBooking
export {
  generateCoachSlots,
  generateCoachSlotsScheduled,
  onCoachAvailabilityWritten,
} from './coaching'

// SaaS billing (Linyup's own platform subscriptions — Stripe)
export {
  createCheckoutSession,
  handleStripeWebhook,
  cancelSaasSubscription,
  getSaasInvoices,
  reactivateSaasSubscription,
  getBillingPortalUrl,
  activatePluginAddon,
  deactivatePluginAddon,
  handleTrialLifecycle,
} from './saas-billing'

// Locked plugins (key-gated) + the in-app AI assistant
export { unlockPlugin } from './plugins/unlockPlugin'
export { assistantChat } from './assistant'

// Kiosk mode (entrance-tablet PIN unlock)
export { unlockKiosk } from './kiosk'

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

// Team-level billing (BYO — teams charging their own students on their OWN
// gateway account; no platform fee). Both webhooks record into payment_events.
export { handlePayrexxWebhook } from './billing/handlePayrexxWebhook'
export { handleTeamStripeWebhook } from './billing/handleTeamStripeWebhook'

// Email sending (Brevo) — BYO domain authentication + event webhook.
// Sender resolution + the central mail service live in ./mail and are called
// by every send site via ../utils/email.
export { registerSenderDomain, checkSenderDomain, useManagedSender } from './mail/domainAuth'
export { sendTestEmail } from './mail/sendTestEmail'
export { handleBrevoWebhook } from './mail/handleBrevoWebhook'

// Stripe Connect (member → studio payments; studio's own Stripe balance + platform fee)
export { startConnectOnboarding, getConnectStatus } from './connect'
export {
  createMemberPayment,
  createMemberSubscription,
  createMembershipPayment,
  createMembershipCheckout,
  createProductCheckout,
  createCourseCheckout,
  pauseMemberSubscription,
  resumeMemberSubscription,
  cancelMemberSubscription,
} from './connect/payments'
export { refundMemberPayment } from './connect/refunds'
export { handleConnectWebhook } from './connect/webhook'
// Cross-rail payment editing (assign contact + edit comment + line-item) for Connect + BYO.
export { updatePaymentRecord } from './connect/updatePayment'
// Manual cash / bank-transfer payments — recorded into the unified payment_events ledger.
export { recordManualPayment } from './payments/recordManualPayment'

// Finance — monthly rollups of the finance journal (always-on core infra) and
// the plugin-gated monthly CSV export.
export { monthlyFinanceReports } from './finance/monthlyReports'
export { exportFinanceReport } from './finance/exportReport'

// Outreach
export { sendOutreachEmail } from './outreach'

// Referrals
export {
  generateReferralCodes,
  confirmReferral,
  getMyReferralCode,
  getMyReferralStats,
} from './referrals'

// Bio-link
export { getInTouchForm } from './bio-link/getInTouchForm'

// Custom Forms plugin — public submission callable
export { submitForm } from './forms/submitForm'

// Website plugin (studio site builder) — publish/unpublish the public snapshot
export { publishWebsite, unpublishWebsite } from './website'

// Organization website (org-level public site) — publish/unpublish the public snapshot
export { publishOrgWebsite, unpublishOrgWebsite } from './orgWebsite'

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
