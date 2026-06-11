> **⚠️ STATUS: DRAFT / WORK IN PROGRESS — not definitive. Pricing figures and tier boundaries are indicative and subject to change.**

---

# HMD SaaS Strategy — Product & Pricing Blueprint

## 1. Product Philosophy

The platform is **not a generic CRM**.

It is:

> **An operating system for coaching businesses — group classes or 1:1 training**

Core value drivers:

* **Revenue generation** (subscriptions, referrals)
* **Retention** (engagement, gamification, communication)
* **Operational efficiency** (sessions, appointments, automation)

All features must map to at least one of these.

---

## 2. Tiering Strategy (Value-Based, Not Feature Dump)

The system is structured around **business maturity**, not arbitrary feature grouping.

### Tier 0 — Free (Getting Started)

**Persona:**

* Someone *starting* a coaching business — first handful of clients, no urgency to pay
* Evaluators who outlast a time-boxed trial

**Model:**

* Full Coach feature set, differentiated by **limits**, not feature flags:
  * **10 active contacts — hard cap** (manual adds blocked at the limit; public
    bio link signups still land, so the cap breach itself becomes the upgrade prompt)
  * **Single user** (no team member invitations)
  * **No plugin add-ons** (catalogue browsable, everything upgrade-locked)
  * **"Powered by Linyup" badge** on the public bio link (every free bio link is a
    referral surface; removing the badge is a paid perk)
* CHF 0, no payment method, no Stripe subscription
* Lifecycle: every signup still starts on the 14-day full-access Studio trial; on
  expiry the team **downgrades to Free** (data kept, no wall, no purge). Cancelled
  paid subscriptions also land here.

**Why it exists:** the contact cap scales with customer success — Free is
genuinely useful at ≤10 clients and any economically real coaching business
outgrows it quickly, converting exactly when the product has proven its value.

> **Plan code:** `free`

### Tier 1 — Coach (Solo Operator)

**Persona:**

* Solo coach, personal trainer, or small independent instructor
* 10–60 active clients
* May run group sessions, 1:1 appointments, or both
* Sells memberships, session packages, or monthly retainers — often all three

**Goal:**

* Run sessions and 1:1 appointments
* Let clients book online without back-and-forth
* Manage contacts and billing in one place

**Core Features:**

* Contacts & client profiles
* Session management (single sessions + simple series)
* Public booking page (group sessions)

* **Coaching — 1:1 appointment booking**
  * Availability templates: define recurring windows (days × time × duration)
  * Auto-generated appointment slots from templates (daily task)
  * Bio link-based client self-booking (same public URL as group session booking — no app required)
  * Confirmation emails with **.ics calendar invite** sent to both client and coach
  * Booking reminder email before the appointment
  * Named service types (e.g. "Personal Training", "Assessment", "Online Consultation")
  * Online session support: optional meeting URL per slot (Zoom, Meet, etc.) included in confirmation email
  * Buffer time between consecutive slots (coach-configurable)
  * Minimum advance booking notice (e.g. must book ≥ 24h ahead)
  * Coach dashboard: upcoming appointments list with client contact details, one-click cancel

* **Monetization**
  * Subscriptions — recurring billing (monthly retainers, class memberships)
  * Session packages — one-off credit bundles, single data model with type discriminator:
    * `group_sessions` — class packs (e.g. 10-class pass)
    * `coaching` — 1:1 bundles (e.g. 5 PT sessions)
    * UI shows packages and subscriptions together in the contact's "Subscription & membership" section
  * Payment tracking — manual or via payment gateway (Stripe, Payrexx)

* **Coaching productivity**
  * Session notes — coach writes a post-session note after each 1:1; surfaces in contact activity timeline
  * Progress check-ins — client submits weight, mood (1–5), and a short note between sessions; coach reviews timeline in training profile
  * Client intake / assessment form — pre-session onboarding: goals, experience level, injuries, notes; populates contact profile
  * Slot waiting list — when a coaching slot is full, clients can join a waiting list and are notified if a spot opens

* **Goals & progress framework** (extends existing goals system)
  * Long-term goals — numeric targets with a deadline (e.g. lose 5 kg by June); coach and client both comment and evaluate progress
  * Short-term tasks / homework — boolean-completion goals assigned by coach after a session (e.g. "3× stretch routine this week"); client marks done; coach sees completion rate
  * Progress photos — photo attachments on goal progress updates; photos are evidence toward a specific goal, not a standalone gallery
  * Bidirectional comment thread on each goal — coach and client annotate progress entries; visible in contact profile and student app
  * Unified "Goals & Progress" section in contact profile covering all three types

* **Resource sharing**
  * Coach attaches files (PDFs, links, videos) to a contact or to a specific coaching slot
  * Displayed as a simple list in the contact profile — not a structured library
  * Client can access shared resources via bio link or mobile app

* QR-based self check-in
* Public profile / link-in-bio page
* Sign-up forms
* Basic dashboard (attendance, simple stats)
* Alerts (manual or simple triggers)
* Booking flow communications (confirmation, reminder, reschedule, no-show follow-up)

**Constraints (important):**

* Max 1 team manager
* No advanced automation
* No student app (clients book via bio link/web; app is Studio)

**Product Intent:**

* Extremely fast onboarding (≤10 min setup)
* Immediate utility for both group-class coaches and personal trainers
* Low cognitive load

**Note for personal trainers:** The Coach plan replaces three tools in one — Calendly/Acuity for 1:1 scheduling, a subscription/package billing tool, and a client CRM. Clients self-book via the public bio link, receive calendar invites automatically, and the coach manages sessions, billing, and client progress in one place.

> **Plan code:** `coach`

---

### Tier 2 — Studio (Core Revenue Tier)

> **Naming (2026-06):** this tier was renamed **Club → Studio** to appeal to the
> broader sport & wellness segment (yoga/pilates/PT studios) without excluding
> sports clubs. Because the product was pre-launch (seed data only), the rename
> was applied **in full**: plan ID `studio`, Stripe lookup key
> `linyup_studio_monthly`, seeds and migration scripts aligned. Display names
> still live solely in the `Plans` i18n namespace (`apps/web/messages/*.json`)
> via `usePlanName()` — once real customers exist, any future rename must be
> display-only (plan IDs become immutable).

**Persona:**

* Gym / club (e.g. boxing, martial arts, fitness studio)
* 50–300 students
* Wants growth + retention

**Goal:**

* Monetize members
* Automate operations
* Increase engagement

**Core Features (in addition to Coach):**

#### Monetization

* Advanced billing features built on top of Coach plan:
  * Automated payment failure handling and retry logic
  * Automated payment reminders (overdue notices)
  * Subscription revenue analytics (MRR, churn, LTV)

#### Engagement

* Student mobile app (iOS + Android)

* **Coaching — mobile app integration** (extends Coach plan's 1:1 system)
  * In-app slot browsing and booking (upcoming slots carousel + featured next-slot card)
  * Booking and cancellation from within the app (token-based, no login required for simple flows)
  * Push notification reminder 1 hour before a 1:1 appointment
  * Per-client coaching session history visible in student profile
  * Progress notes shared between coach and client (ties into Training Profile)

* Gamification:
  * Points
  * Streaks
  * Leaderboards
  * Badges

#### Automation

* Outreach system:
  * Templates (email/SMS)
  * Automated flows (e.g. inactivity, onboarding)
* Alerts:
  * Trigger-based notifications

#### Insights

* Advanced dashboard
* AI-driven insights (e.g. churn risk, attendance patterns)

#### Team Management

* Multiple team managers
* Role-based access (basic)

#### Growth

* Referral program:
  * Track invites
  * Reward system

**Product Intent:**

* Replace multiple tools (CRM + booking + communication + engagement)
* Drive measurable ROI:
  * Retention ↑
  * Revenue ↑
  * Admin time ↓

**Important:**
👉 This is the **primary monetization tier** — most users should land here eventually.

> **Plan code:** `studio`

---

### Tier 3 — Organization (Multi-Entity Control)

**Persona:**

* Multi-location gyms
* Franchises
* Federations

**Goal:**

* Centralized control
* Cross-team coordination
* Scalability

**Core Features (in addition to Team):**

#### Multi-Team Management

* Multiple teams under one organization
* Central admin access

#### Data & Operations

* Unified data view across teams
* Move contacts between teams

#### Coordination

* Cross-team events
* Invitations across teams

#### Communication

* Cross-team messaging

#### Platform Extensibility

* API access

#### Governance

* Advanced roles & permissions (org-level)

**Product Intent:**

* Enable scaling without operational chaos
* Provide visibility and control at the org level

> **Plan code:** `organization`

---

## 3. Pricing Strategy

### Model: Hybrid SaaS + Usage-Based

**Components:**

1. Base subscription fee (per tier)
2. Variable fee per active student
3. Optional per-plugin add-ons (Coach plan — see *Plugin add-ons* below)

### Pricing Logic

* Pricing scales with **customer success**
* "Active student" = core billing metric
* Keeps entry barrier low while capturing upside

### Suggested Pricing Structure

| Tier         | Base Price  | Included Students | Additional Students |
|--------------|-------------|-------------------|---------------------|
| Free         | CHF 0       | 10 (hard cap)     | — (blocked, upgrade) |
| Coach        | CHF 7.99    | 30                | CHF 0.5–1 / student |
| Studio       | CHF 19–39   | ~100              | CHF 0.5–1 / student |
| Organization | CHF 99–149  | pooled            | volume pricing      |

> **Implementation note:** the per-active-student variable fee is **not yet
> built** — current billing is a flat per-plan price. Per-student metered billing
> remains separate, unscheduled work.

### Plugin add-ons (Coach plan)

Plugins extend a deliberately bare Coach base. **Studio and Org include all
internal plugins** at no extra cost; **Coach** can activate a curated subset
(engagement/content plugins) as **paid monthly add-ons**, each billed as a Stripe
subscription item on top of the Coach base.

Add-on prices are **anchored** so that a coach wanting two or more add-ons
reaches or exceeds the Coach→Studio delta — making Studio the rational choice.

| Add-on | Coach price / mo |
|--------|------------------|
| Gamification | CHF 5 |
| Referrals    | CHF 5 |
| Online Courses | CHF 8 |
| Website | CHF 8 |

*Indicative placeholders. Marquee Studio features — student app, automation,
multiple managers, advanced analytics — are **never** sold à la carte.*

**Mechanics:** plugin **installation is the gate**. Studio/Org owners install
freely; Coach activations go through a Cloud Function that adds the Stripe item
(so paid value can't be self-granted). During the **trial**, coaches activate
add-ons **free** to explore; on conversion the active add-ons carry into the paid
subscription. The catalogue (plans + add-ons) is declared in the repo and synced
to Stripe — see `docs/stripe-catalog.md`.

### Optional Revenue Layer

If payments are integrated (e.g. via Payrexx):

* Add **0.5%–1.5% transaction fee**

Only if you provide real billing + subscription value — otherwise skip to avoid friction.

### Trial Strategy

* **Freemium + trial combined** (decision 2026-06): every signup starts on a
  14-day full-access Studio trial; on expiry the team downgrades to the **Free
  plan** (10-contact hard cap) instead of being walled and purged.
* The trial sells the full product; Free keeps non-converters in the funnel at
  near-zero marginal cost and converts them when they outgrow the cap.

---

## 4. Upgrade Path Design

The system must naturally push users upward:

* **Free → Coach triggers:**
  * Hits the 10-contact hard cap (the primary, success-aligned trigger)
  * Wants a second team member on the account
  * Wants plugin add-ons (gamification, referrals, …)
  * Wants the "Powered by Linyup" badge off their bio link

* **Coach → Studio — hard pulls (Studio-only, never à la carte):**
  * Wants a branded client mobile app (in-app booking, push reminders, coaching history)
  * Wants automated outreach (inactivity follow-ups, onboarding sequences)
  * Needs multiple coaches or managers on the team
  * Wants advanced + AI-driven analytics

* **Coach → Studio — anchored upsells (available as Coach add-ons):**
  * Gamification and the referral program are purchasable as paid add-ons on
    Coach, priced so that wanting both approaches the Studio price — they pull
    toward Studio rather than blocking it.

* **Studio → Organization trigger:**
  * Manages multiple locations
  * Needs centralized control

Features must be distributed to **create pull**, not force upgrades artificially.

---

## 5. Key Differentiation

Avoid competing as "Gym CRM". Position as:

> **Retention and growth platform for coaching businesses**

Core differentiators:

* Built for any coaching business — group classes, personal training, or hybrid
* 1:1 appointment booking with calendar integration (replaces Calendly for coaches)
* Strong attendance + engagement loop
* Gamification layer
* Mobile-first student/client experience

---

## 6. Core System Modules

The platform should be modular, with these domains:

| Module | Description |
|--------|-------------|
| Contacts & CRM | Client profiles, lifecycle, alerts |
| Sessions & Scheduling | Single + recurring sessions, calendar |
| Bookings | Bio link booking, QR check-in, self check-in |
| Coaching & 1:1 scheduling | Availability templates, slot generation, client self-booking, calendar invites, session notes, waiting list |
| Goals & progress | Long-term goals, short-term tasks/homework, progress photos, bidirectional coach–client comment thread |
| Resource sharing | File and link attachments per contact or coaching slot, accessible via bio link and mobile app |
| Payments & Subscriptions | Recurring billing, session packages (class packs + coaching bundles), payment tracking |
| Communication | Email / SMS / push notifications |
| Automation engine | Triggers + workflows |
| Gamification engine | Points, streaks, leaderboards, badges |
| Analytics & insights | Dashboard, AI-driven signals |
| Multi-team / org layer | Organization hierarchy, cross-team ops |
| Public pages | Booking page, public profile / link-in-bio |

Each module should be independently extensible and tier-gated. Plugin-delivered
modules (gamification, referrals, courses, …) are gated by **plugin installation**
(the packaging/billing gate); non-plugin tier features use feature flags.

---

## 7. Non-Goals

To avoid scope creep:

* ❌ Full accounting system (defer or integrate externally)
* ❌ Generic CRM features not tied to gym workflows
* ❌ Over-complex reporting in early versions

Focus on: simplicity, speed, real gym use cases.

---

## 8. Success Metrics

| Metric | Why it matters |
|--------|----------------|
| Activation time (setup → first booking) | Measures onboarding friction |
| Monthly active students per customer | Proxy for customer health |
| Gym retention rate | Core SaaS health metric |
| Subscription adoption rate (Team tier) | Revenue quality |
| Feature usage: automations, app, referrals | Stickiness drivers |

---

## 9. Strategic Priorities (Execution Order)

1. Core operations (Coach tier fully usable)
2. Payments + subscriptions
3. Student app
4. Automations
5. Gamification
6. Org-level features
7. APIs

---

## 10. Key Insight

> Users don't pay for software.
> They pay for **more members, better retention, and less admin work**.

Every feature should clearly support one of these outcomes.
