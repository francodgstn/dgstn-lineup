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
export { sendContactVerificationCode } from './auth/sendContactVerificationCode'
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
// Waitlist (class-only) — join/leave the queue for a full class, and the
// promoter that offers a seat to the front of it. The promoter is a session
// TRIGGER, not a call site hook: every event that frees a seat converges on a
// session-document write. See booking/waitlist/promote.ts.
// The claim settles a seat that is ALREADY held — free through
// claimWaitlistSeat, paid through the ordinary createDropInCheckout with the
// offer token attached. The hourly sweep (booking/waitlist/sweep.ts) rolls a
// lapsed offer on and rides bookingRemindersHourly, so it exports no function
// of its own.
// `getWaitlistEntry` is what makes the two token links resolvable at all: the
// queue is never client-readable without a contact session, and a guest who
// joined from the public form has only the token in their mail.
export { joinWaitlist } from './booking/waitlist/join'
export { claimWaitlistSeat } from './booking/waitlist/claim'
// `listMyWaitlist` is the signed-in counterpart: the rules can authorise a
// contact to GET their own entry, but never to LIST their entries across
// sessions, so the member surfaces need a callable for it.
export { getWaitlistEntry, leaveWaitlist, listMyWaitlist } from './booking/waitlist/manage'
export { promoteWaitlistOnSeatFreed } from './booking/waitlist/promote'
// A queue whose class will never run. Hung on the session document, not on
// cancelSession, because a standalone session is deleted client-side.
export { teardownWaitlistOnSessionDeleted } from './booking/waitlist/teardown'
// The studio's own row actions. Callables, never client writes — the rules deny
// every client write to the queue, including a schedule.manage holder's.
export { promoteWaitlistEntry, removeWaitlistEntry } from './booking/waitlist/admin'

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

// Appointments (1:1 slots) — activity-bound, availability-only. Nothing is
// pre-generated: listAvailability computes free starts on the fly and
// bookAppointment materialises a Session lazily (overlap-safe) at booking
// time; the paid-access gate is shared with bookSession via booking/access.ts.
// Cancellation is handled by the shared cancelBooking callable.
export { listAvailability, bookAppointment } from './appointments/window'
// Paid appointments — reserve→pay→confirm via Stripe Connect (see checkout.ts).
export { createAppointmentCheckout } from './appointments/checkout'
// Staff "phone booking" — a manager creates/blocks an appointment directly
// from the admin (existing/new contact, free/paid-offline/pending-offline/
// payment-link), and settles a pending offline hold once paid in person.
export { createStaffAppointment, markAppointmentPaid } from './appointments/staffBooking'

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
// Gift cards (E3) — public purchase + balance check, manager mint + void.
export {
  createGiftCardCheckout,
  checkGiftCard,
  issueGiftCard,
  voidGiftCard,
} from './connect/giftCards'
// Promo codes (Wave 3 Phase 3) — the public quote plus the manager lifecycle.
// A promo is a Stage A price MODIFIER: `previewPromoCode` only QUOTES, the code
// is applied inside resolvePaymentOptions, and the reserve/commit/release
// engine is called from the checkout callables and the webhook rather than
// being exposed. The two manager corrections are deletes of lifecycle state —
// neither touches `usage_count`, which has exactly one writer.
export {
  previewPromoCode,
  createPromoCode,
  updatePromoCode,
  setPromoCodeStatus,
  clearPromoRedemption,
  releasePromoReservations,
} from './connect/promoCodes'
// No-show policy fees (E5) — manager resend-link + waive. The strike counter
// itself (processNoShowStrike) is wired into automation/onBookingWrite, not a
// callable.
export { resendPolicyFeeLink, waivePolicyFee } from './booking/policyFees'
// Cross-rail payment editing (assign contact + edit comment + line-item) for Connect + BYO.
export { updatePaymentRecord } from './connect/updatePayment'
// Manual cash / bank-transfer payments — recorded into the unified payment_events ledger.
export { recordManualPayment } from './payments/recordManualPayment'

// Finance — monthly rollups of the finance journal (always-on core infra) and
// the plugin-gated monthly CSV export.
export { monthlyFinanceReports } from './finance/monthlyReports'
export { exportFinanceReport } from './finance/exportReport'

// Accounting (finance plugin) — double-entry ledger derived from the journal.
export { onFinanceTransactionWrite } from './accounting/onFinanceTransactionWrite'
export { rebuildAccountingLedger } from './accounting/rebuild'
export { createManualEntry, reverseEntry } from './accounting/manualEntries'
export { closeFiscalYear } from './accounting/close'
export { setChartTemplate } from './accounting/settings'

// In-app feedback — ops email notification on new submissions
export { onFeedbackCreated } from './feedback/onFeedbackCreated'

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
