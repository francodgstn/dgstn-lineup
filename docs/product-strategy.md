> **⚠️ STATUS: DRAFT / WORK IN PROGRESS — not definitive. Pricing figures and tier boundaries are indicative and subject to change.**

---

# HMD SaaS Strategy — Product & Pricing Blueprint

## 1. Product Philosophy

The platform is **not a generic CRM**.

It is:

> **An operating system for coaching businesses (especially combat sports gyms)**

Core value drivers:

* **Revenue generation** (subscriptions, referrals)
* **Retention** (engagement, gamification, communication)
* **Operational efficiency** (sessions, attendance, automation)

All features must map to at least one of these.

---

## 2. Tiering Strategy (Value-Based, Not Feature Dump)

The system is structured around **business maturity**, not arbitrary feature grouping.

### Tier 1 — Coach (Solo Operator)

**Persona:**

* 1 coach
* 10–40 active students
* No complex monetization yet

**Goal:**

* Run sessions
* Accept bookings
* Manage contacts simply

**Core Features:**

* Contacts & student profiles
* Session management (single sessions + simple series)
* Public booking page
* QR-based self check-in
* Public profile / link-in-bio page
* Sign-up forms
* Basic dashboard (attendance, simple stats)
* Alerts (manual or simple triggers)

**Constraints (important):**

* Max 1 team manager
* No advanced automation
* No subscriptions (or very limited/basic if needed for upsell bridge)
* No student app

**Product Intent:**

* Extremely fast onboarding (≤10 min setup)
* Immediate utility
* Low cognitive load

> **Plan code:** `coach`

---

### Tier 2 — Club (Core Revenue Tier)

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

* Subscriptions (recurring billing)
* Payment tracking (if integrated via gateway like Payrexx)

#### Engagement

* Student mobile app (iOS + Android)
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

> **Plan code:** `club`

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

### Pricing Logic

* Pricing scales with **customer success**
* "Active student" = core billing metric
* Keeps entry barrier low while capturing upside

### Suggested Pricing Structure

| Tier         | Base Price | Included Students | Additional Students |
|--------------|------------|-------------------|---------------------|
| Coach        | €19–29     | ~20               | €0.5–1 / student    |
| Club         | €59–99     | ~100              | €0.5–1 / student    |
| Organization | €149–299   | pooled            | volume pricing      |

### Optional Revenue Layer

If payments are integrated (e.g. via Payrexx):

* Add **0.5%–1.5% transaction fee**

Only if you provide real billing + subscription value — otherwise skip to avoid friction.

### Trial Strategy

* No freemium (to avoid low-quality users)
* Use: 14–30 day free trial OR free up to X students (e.g. 10)

---

## 4. Upgrade Path Design

The system must naturally push users upward:

* **Coach → Club trigger:**
  * Needs subscriptions
  * Wants automation
  * Wants branded student experience (app)

* **Club → Organization trigger:**
  * Manages multiple locations
  * Needs centralized control

Features must be distributed to **create pull**, not force upgrades artificially.

---

## 5. Key Differentiation

Avoid competing as "Gym CRM". Position as:

> **Retention and growth platform for coaching businesses**

Core differentiators:

* Built for class-based sports (especially combat sports)
* Strong attendance + engagement loop
* Gamification layer
* Mobile-first student experience

---

## 6. Core System Modules

The platform should be modular, with these domains:

| Module | Description |
|--------|-------------|
| Contacts & CRM | Student profiles, lifecycle, alerts |
| Sessions & Scheduling | Single + recurring sessions, calendar |
| Bookings | Portal booking, QR check-in, self check-in |
| Payments & Subscriptions | Recurring billing, payment tracking |
| Communication | Email / SMS / push notifications |
| Automation engine | Triggers + workflows |
| Gamification engine | Points, streaks, leaderboards, badges |
| Analytics & insights | Dashboard, AI-driven signals |
| Multi-team / org layer | Organization hierarchy, cross-team ops |
| Public pages | Booking page, public profile / link-in-bio |

Each module should be independently extensible and tier-gated via feature flags.

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
