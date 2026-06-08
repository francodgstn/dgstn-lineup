> **⚠️ PROPOSAL / FOR REVIEW — not yet merged into `product-strategy.md`.**
> Drafted to capture the "Club-included, Coach paid add-ons" plugin packaging
> decision. Pricing figures are indicative placeholders.

# Proposed revisions to Product & Pricing Strategy — Plugin packaging

This proposes targeted changes to **§3 Pricing Strategy** and **§4 Upgrade Path
Design**, plus a new "Plugin packaging" subsection. Everything else in
`product-strategy.md` stays as written.

---

## Why

The platform now has a modular **plugin** layer (gamification, referrals, club
courses, club website, AI insights, etc.). We want a packaging model that:

1. Keeps **Club** the primary monetization tier (most users should land there).
2. Lets a **Coach** extend a deliberately bare base with **paid add-ons** — both
   a revenue stream and a transparent upgrade lever.
3. Doesn't give paid value away for free (no freemium — consistent with §3).

---

## Decision

| | Coach | Club / Org |
|---|---|---|
| Plugins | **À la carte** — a curated subset (engagement/content) activatable as paid add-ons; other club plugins are upgrade-locked | **All internal plugins included**, activate freely |
| Marquee features (student app, automation/outreach, multiple managers, advanced analytics) | Not available (tier-exclusive) | Included |

The curated à-la-carte subset is intentionally limited to **engagement &
content** plugins (gamification, referrals, club courses, club website). The
**marquee Club differentiators are never sold à la carte** — they remain the
hard upgrade pull.

---

## Proposed §3 (Pricing Strategy) — add an add-on dimension

Keep the existing model (base per tier + per-active-student) and **add**:

> **Add-on layer (Coach only).** Coach can activate individual plugins as
> recurring monthly add-ons. Each add-on has its own price. Club and Org include
> all internal plugins at no extra cost.
>
> Add-on prices are **anchored** so that a Coach wanting two or more add-ons
> reaches or exceeds the Coach→Club price delta — making Club the rational
> choice. Example (indicative): add-ons CHF 5–8/mo each; once a coach wants 2,
> Club (which includes everything) is the better deal.

Indicative add-on prices (placeholders, to finalise):

| Plugin | Coach add-on /mo |
|---|---|
| Gamification | CHF 5 |
| Referrals | CHF 5 |
| Club Courses | CHF 8 |
| Club Website | CHF 8 |

> **Note:** the documented **per-active-student** variable fee (§3) is **not yet
> implemented** in billing — current billing is flat per-plan. Per-student
> metered billing remains separate, unscheduled work.

---

## Proposed §4 (Upgrade Path) — triggers become anchored upsells

§4 currently lists *gamification* and *referral program* as hard Coach→Club
triggers. Reframe:

> - These engagement plugins are now **available to Coach as paid add-ons**, so
>   they act as **anchored upsells** rather than hard walls: a coach can taste
>   one, but the pricing nudges multi-add-on coaches toward Club.
> - The **hard** Coach→Club pulls remain the **marquee, non-plugin features**:
>   branded student app (in-app booking, push), automated outreach/flows,
>   multiple managers, advanced + AI analytics. These are never à la carte.

Net effect: the upgrade path keeps its pull (marquee features), gains a softer
on-ramp (try one add-on), and monetizes coaches who aren't ready for Club.

---

## New subsection — "Plugin packaging" (mechanics)

- Plugins are gated by **installation**, which is the single source of truth for
  plugin-delivered features (e.g. the gamification page/tab show when the plugin
  is installed). Plan feature-flags for plugin features are superseded by
  install state.
- **Club/Org:** owners activate/deactivate plugins freely (no charge).
- **Coach:** activating a curated add-on adds a **Stripe subscription item** to
  the team's subscription; deactivating removes it. Non-curated club plugins
  show an upgrade prompt.
- Enforcement: on Coach, plugin activation goes through a Cloud Function (which
  also creates the install record), so paid value can't be self-granted.

---

## Open questions for review

1. Final add-on prices + the exact curated subset (currently gamification,
   referrals, club courses, club website).
2. Coach **trial** behaviour: are add-ons chargeable/activatable during the
   14–30 day trial, or only on a paid Coach plan?
3. Should Org ever differ from Club here (currently treated identically)?
