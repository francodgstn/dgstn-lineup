# Migration Checklist — hmd-lineup → dgstn-lineup

Reference project: `C:\git\hmd\hmd-lineup`

Legend: ✅ done · ⏳ in progress · ❌ not started · ~~skipped~~ (out of scope)

---

## Infrastructure & Config

- ✅ pnpm workspaces + Turborepo root setup
- ✅ `packages/shared` — TypeScript types + Firestore path constants
- ✅ `firestore.rules` — ported verbatim, adapted for teamId model
- ✅ `firestore.index.json` — ported verbatim
- ✅ `storage.rules`
- ✅ `database.rules.json`
- ✅ `firebase.json` + `.firebaserc`
- ✅ Firebase emulator config (demo-lineup project)
- ✅ CI/CD — `.github/workflows/verify.yml` + `deploy.yml`

---

## packages/functions — Utils

- ✅ `async.ts` — `to()` helper
- ✅ `email.ts` — `sendEmail()`
- ✅ `secrets.ts` — secret access wrapper
- ✅ `recurrence.ts` — DST-safe Europe/Zurich recurrence logic
- ✅ `teams.ts` — `isTeamMember()`, `hasTeamRole()`
- ❌ `contacts.ts` — count helpers (`countContactsByType`, etc.) — currently inline in `analytics/index.ts`
- ❌ `users.ts` — `getUserWeeklyReport()`, `findUserWeeklyReportByDate()`

---

## packages/functions — Cloud Functions

### Teams & Auth
- ✅ `createTeam`
- ✅ `validateTeamSlug`
- ✅ `sendTeamInvitation`
- ✅ `getTeamInvitationDetails`
- ✅ `acceptTeamInvitation`
- ❌ `manageTeamInvitation` (club+)
- ❌ `manageTeamMember` (club+)
- ✅ `generateAuthToken`
- ✅ `sendMembershipVerificationCode`
- ✅ `verifyMembershipCode`
- ✅ `completeMembershipSignup`
- ❌ `validateAuthToken`
- ❌ `generateApiKey`

### Sync Triggers
- ✅ `syncTeamPublicProfile`
- ✅ `syncSessionPublicProfile`
- ✅ `syncActivityPublicProfile`
- ✅ `indexUser`
- ✅ `syncSubscriptionTypesToPublicProfile`
- ✅ `onContactSubscriptionChange`
- ✅ `onSessionUpdate`

### Sessions
- ✅ `generateRecurringSessions`
- ✅ `cancelSession`
- ✅ `updateRecurringSession`
- ✅ `selfCheckIn`
- ✅ `generateCoachSlots` (callable) + `generateCoachSlotsScheduled` (daily cron)
- ~~`generateCoachSlotsNow`~~ — merged into `generateCoachSlots` callable
- ❌ `setSessionLocation`
- ❌ `setSessionTags`

### Bookings
- ✅ `bookSession`
- ✅ `sendBookingVerificationCode`
- ✅ `verifyBookingCode`
- ✅ `cancelBooking`
- ✅ `rebookSession`
- ✅ `getBookingDetails`
- ~~`bookTrialSession`~~ — superseded by `bookSession` (handles trial + authenticated portal bookings, referral tracking, IP rate limiting, bookingAuthToken)
- ✅ `bookCoachSlot`
- ✅ `cancelCoachBooking`
- ✅ `trackCoachBookings`

### Contacts
- ✅ `deleteContact`
- ✅ `restoreContact`
- ✅ `checkInContact`
- ✅ `moveContacts`
- ❌ `generateContactQR`
- ~~`sendContactQrCodes`~~ — deprecated; QR code lives in the student mobile app instead
- ❌ `getMembershipQR`
- ❌ `manageContactUpdateRequest`
- ❌ `requestContactUpdate`
- ❌ `switchMembershipContact`

### Events (club+)
- ✅ `sendEventInvitations`
- ✅ `getEventInvitationDetails`
- ✅ `handleEventInvitationResponse`
- ❌ `trackEventAttendees`

### Analytics & Tracking
- ✅ `trackBookings`
- ✅ `trackSessions`
- ✅ `weeklyReports` (scheduled, expanded with full breakdown fields + idempotency guard)
- ✅ `trackContacts`
- ✅ `trackSessionParticipants`
- ❌ `generateDashboardInsight` (AI/Gemini)
- ✅ `dailyTasks` (scheduled cleanup)
- ❌ `triggerAutomationRule`
- ❌ `previewAutomationRule`

### Gamification (club+)
- ✅ `recalculateScores`
- ✅ `resetScores`
- ❌ `processScoresRebuildJob`
- ❌ `triggerScoresRebuild`
- ❌ `recalculateScoresFromDate`

### Outreach & Referrals
- ❌ `sendOutreachEmail`
- ❌ `generateReferralCodes`
- ❌ `confirmReferral`
- ❌ `getMyReferralCode`
- ❌ `getMyReferralStats`

### Portal
- ✅ `portalPreview`
- ❌ `getInTouchForm`

### SaaS Billing
- ✅ `SaasSubscription` shared type (`packages/shared/src/types/saas.ts`)
- ✅ Gateway adapter interface + Stripe adapter + Payrexx stub (`packages/functions/src/utils/gateway/`)
- ✅ `createCheckoutSession` (onCall — Stripe Checkout redirect)
- ✅ `handleStripeWebhook` (onRequest — signature validation, idempotency, saas_subscriptions sync)
- ✅ `cancelSaasSubscription` (onCall — cancel at period end)
- ✅ `getSaasInvoices` (onCall — live from Stripe, not stored)

### Other
- ~~`generateQrBill`~~ (Swiss QR Bill — out of scope)
- ~~`hmdApi`~~ (HMD-specific integration)
- ~~`migrateContactTimestamps`~~ (one-time migration utility)
- ~~`migrateNoShowBookings`~~ (one-time migration utility)
- ~~`setUserPlaceLabel`~~ (HMD place system — evaluate if needed)
- ~~`setUserSessionsTag`~~ (HMD tag system — evaluate if needed)
- ~~`updateUserPlaceRefs`~~ (HMD place system)
- ~~`updateUserSessionsTagRefs`~~ (HMD tag system)

---

## apps/web — Foundation

- ✅ Next.js 15 App Router scaffold
- ✅ shadcn/ui component library
- ✅ Tailwind CSS
- ✅ TanStack Query v5 provider
- ✅ AuthContext + `useAuth()`
- ✅ next-intl i18n (en, de, fr, it)
- ✅ Firebase emulator connection
- ✅ Auth layout: sidebar, topbar, mobile drawer, collapse mode
- ✅ Plan gating: `PlanGate`, `usePlan()`, locked nav items → upgrade page
- ✅ Upgrade page (`/upgrade`)

---

## apps/web — Auth routes

### Dashboard
- ✅ Overview cards (contacts snapshot, recent sessions, alerts)
- ✅ RosterCard (donut chart — type / membership / subscription / billing views)
- ✅ TrendsSection (gated club+): BookingsTrendCard, SessionsHeatmapCard, ContactsSummaryCard, TopActivitiesCard, TrialFunnelCard
- ❌ AI Insights card (requires `generateDashboardInsight`)

### Contacts
- ✅ Contacts list page
- ✅ Contact detail page (`/contacts/[id]`) — profile, notes, activity, alerts, bookings, subscriptions, goals, gamification tabs
- ✅ Contact create flow (new contact dialog in contacts list page)

### Sessions
- ✅ Sessions list page
- ✅ Sessions calendar view (custom mini-grid + day detail panel — react-big-calendar removed)
- ✅ Session detail page (`/sessions/[id]`)
- ✅ New session / recurring session wizard

### Activities
- ✅ Activities list + create/edit/archive

### Events (club+)
- ✅ Events list page
- ❌ Event detail page
- ❌ Event invitation flow

### Bookings
- ✅ Bookings list page (basic)
- ✅ Booking management — confirm (creates participant), revert to pending, mark no-show, cancel, rebook

### Coaching
> Restructured: there is no separate `/coaching` admin page. Coaching is modelled as an activity type
> (`type: 'group_class' | 'coaching'` on `Activity`). Sessions inherit `activityType` from their linked
> activity. Coach slot generation remains a backend concern. The portal-side booking flow is intact.
- ✅ Activity `type` field (group_class | coaching) — selectable in Activities form; sessions inherit `activityType`
- ✅ Coach slot generation functions (`generateCoachSlots`, `generateCoachSlotsScheduled`)
- ✅ Coach booking flow (portal: `/portal/[slug]/coaching` + cancel page)
- ~~Admin `/coaching` page~~ — intentionally removed; coaching sessions live in the Sessions page

### Gamification (club+)
- ⏳ Stub page only — no leaderboard or scoring UI

### Team
- ✅ Team settings page
- ✅ Team portal settings
- ✅ Team members page (view only)
- ❌ Invite / manage members UI (club+)
- ✅ Subscription types management (CRUD in team settings — name, description, source, active toggle)
- ✅ Payment gateway config (Payments tab in team settings — add/edit/delete Stripe/Payrexx gateways)

### Billing
- ✅ Billing page (`/billing`) — subscription status, plan selection, invoice history, cancel flow
- ✅ Sidebar nav entry

### Portal (public, unauthenticated)
- ✅ Public profile page
- ✅ Session booking flow
- ✅ Trial sign-up form
- ❌ Contact update request form
- ❌ Event RSVP page (club+)

---

## apps/mobile (Student App)

- ✅ Full port of hmd-lineup student-app with Lineup branding
- ✅ Auth (membership token, `student_auth_tokens`)
- ✅ Home screen / welcome messages
- ✅ Session check-in (QR scan + self check-in)
- ✅ Profile screen
- ✅ OTA update handling

---

## Security & Data Model

- ✅ Firestore security rules — full port + teamId model
- ✅ `public_profile` pattern enforced for all portal-facing data
- ✅ Sync triggers for team, session, activity public profiles
- ❌ `syncSubscriptionTypesToPublicProfile` trigger
- ❌ Firestore indexes reviewed for all new queries added during migration
