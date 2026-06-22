# Payments: contact → studio

> **Scope:** how a studio/coach collects money **from their contacts** (members) —
> memberships, drop-ins, shop, courses. Two rails exist; both feed **one** unified
> payments view inside Linyup.
>
> | Rail | Money settles on | Platform fee | Linyup does |
> |---|---|---|---|
> | **Pay via Linyup** (Stripe Connect) | the **studio's** Stripe balance | yes (per-tier) | runs checkout, refunds, reconciliation |
> | **BYO gateway** (Payrexx / Stripe-BYO) | the studio's **own** account | no | **records** the payment + links a contact (minimal) |
>
> CHF-first (with TWINT on Connect). All money is **integer minor units** (Rappen) — never floats.

## The three payment concerns (don't conflate them)

| Concern | Money settles on | Where | Doc |
|---|---|---|---|
| Linyup SaaS billing (Linyup charges studios) | **Linyup** | `saas-billing/`, `getPlatformStripeAdapter()` | [payment-studio-linyup.md](payment-studio-linyup.md) |
| contact → studio **+ platform fee** (Connect) | **Studio** | `connect/`, `utils/connect/` | this doc |
| contact → studio, **no fee** (BYO) | **Studio** | `billing/handlePayrexxWebhook`, `billing/handleTeamStripeWebhook` | this doc |

---

## Unified payments view (both rails)

The web **Payments** page (`/payments`) and the per-contact **Payments** tab merge
both rails in the read layer — Connect (`member_payments` / `member_subscriptions`)
+ BYO (`payment_events`) — into one list. Nav shows the page when Connect is enabled
**or** any BYO gateway is configured.

**Contact matching (both rails).** Email is **not** a unique key in Linyup — a
parent's address routinely controls several child contacts — so a payment links to a
contact only when **exactly one** active contact matches the payer email
(`resolveSingleContact`, `packages/functions/src/utils/contacts.ts`). Zero or
multiple matches → the payment is still **recorded as Unassigned**, and a manager
assigns it. (The public Connect **shop** keeps its approved behaviour: 1 match →
link, 0 → auto-create the contact cap-aware, >1 → Unassigned, never guess.)

**Assign + comment.** One callable, `updatePaymentRecord({ teamId, source:
'connect'|'byo', paymentId, contactId?, comment? })` (manager-only), handles
(re)assigning the contact **and** editing a free-text `comment` ("what was paid")
for either rail. On assign it stamps `last_payment_at` + an `activity_log` entry;
BYO docs additionally re-apply the subscription linkage. The comment is prefilled
with a default suggestion and the UI offers preset quick-picks
(`PAYMENT_COMMENT_PRESETS` in `@linyup/shared`, i18n'd via `PaymentComment.preset_*`).

---

# Rail A — Pay via Linyup (Stripe Connect)

Studio collects from members **+ Linyup takes a configurable platform fee**. Money
settles on the **studio's** Stripe balance via **direct charges** — it never passes
through Linyup's balance. This is the first-class, fully-integrated rail.

## Architecture (locked)

- **Accounts v2 API** (`stripe.v2.core.accounts` / `accountLinks`) with controller-style
  `defaults.responsibilities` — **not** the legacy Standard/Express/Custom account types.
- **Direct charges** on the connected account via Checkout Sessions, with
  `application_fee_amount` (one-off) / `application_fee_percent` (subscriptions).
- **One account configuration** (Standard-equivalent: `dashboard: 'full'`). The studio
  picks a framing on the Linyup side — **"Use my Stripe account"** (connect existing) or
  **"Create a new account"** (guided) — but both produce the same Standard account, and
  the Stripe-hosted Account Link supports both signing into an existing account and
  creating a new one. (Originally specced as two account types — BYO `full` + Managed
  `express` — but test mode confirmed Stripe forbids "studio pays fees + Stripe bears
  losses" on a non-full dashboard, so the express/embedded Managed account was dropped.)
- **CHF only** in Phase 1.
- Feature-flagged per team (`teams/{teamId}.payments.connectEnabled`) so it ships dark.

### The three §6 decisions (final values)

1. **Fee-payer →** the **studio pays Stripe fees** (`fees_collector: 'stripe'`);
   Linyup's application fee is clean margin and **losses are assigned to Stripe**
   (`losses_collector: 'stripe'`) — Linyup is never liable. To satisfy both, the account
   must use the full dashboard (Standard), so there is **one** account config (see above);
   the separate "Managed/express" account from the brief was dropped after test-mode
   confirmed the combination is unsupported.
2. **Per-tier take-rate (final, signed off 2026-06-20):**

   | Tier | Application fee |
   |---|---|
   | Free | 1.7% |
   | Coach | 1.2% |
   | Studio *(brief's "Club")* | 0.7% |
   | Organization | 0.4% |

   Config lives in `packages/shared/src/types/connect.ts` → `CONNECT_TAKE_RATE`
   (basis points + optional minimum fee). The **only** fee entry points are
   `computePlatformFee()` (one-off, returns Rappen) and `takeRatePercent()`
   (subscriptions, returns a percent). No fee is hardcoded anywhere else.
3. **TWINT + direct-charge + Connect — validate in test mode.** Documented constraint:
   only **one active TWINT mandate per studio↔member pair**. See "Validate in test mode".

### Liability (single Standard config — both framings)

| | Standard account (`dashboard: 'full'`) |
|---|---|
| Stripe processing fees | Studio (`fees_collector: 'stripe'`) |
| Negative balance / chargeback loss | Stripe (`losses_collector: 'stripe'`) |
| Requirements / KYC | Stripe-collected |
| Linyup liability | none |

## Required secrets / env vars

| Secret (Secret Manager id) | Env var (emulator) | Purpose |
|---|---|---|
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | Platform key — **reused** from SaaS billing. The Connect platform *is* Linyup's Stripe account. Prefer a **restricted key** with Connect write scope in prod. |
| `stripe-connect-webhook-secret` | `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for the **Connect** webhook endpoint (separate from `stripe-webhook-secret`, the SaaS-billing endpoint). |

Terraform provisions the container in all environments (`infra/environments/*/variables.tf`
→ `secret_ids`). Add the value out-of-band:

```bash
echo -n "<whsec_...>" | gcloud secrets versions add stripe-connect-webhook-secret --project=linyup-staging --data-file=-
```

For local dev add to `packages/functions/.env.local`:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...   # from `stripe listen` (Connect), see below
```

## Enabling the feature

**Self-serve.** Any team owner can set it up from **Settings → Payments** ("Set up
payments") and onboard their Stripe account — no operator action needed. The card is
visible by default. An operator can **disable** a team (kill-switch) by setting
`teams/{teamId}.payments.connectEnabled = false` (admin-only; the team `payments` map
is admin/function-only in `firestore.rules`). Absent/`true` = allowed; only an
explicit `false` blocks. The **Payments** nav entry appears once a team has started
onboarding (a connected account exists) or has a BYO gateway configured.

### Operator console (apps/admin)

The accounts **list** shows a per-team Connect status badge (Enabled / Restricted /
Pending / Not set up / Disabled). The account **detail** page has a "Payments · contact
→ studio" card: onboarding model, charges/payouts enabled, connected-account id,
outstanding requirements, and aggregated totals (gross collected, Linyup fees earned,
refunded, payment count, active subscriptions). The admin app reads via the Admin SDK
(server-side), so no Firestore rule changes are needed.

## Selling subscription types (membership linkage)

Connect is the payment rail for the team's **subscription types** (the membership
catalog, `teams/{teamId}/subscription_types`). `createMembershipPayment` resolves a
chosen `subscription_type` + price and routes by recurrence:

- **Recurring** (`weekly`/`biweekly`/`monthly`/`quarterly`/`annual`) → a Stripe
  subscription on the connected account (interval + `interval_count`).
- **One-off** (`one_time`, `per_class`) → a single direct charge. A `one_time` price
  carries `included_months`; on payment the member's `membership_expiration` is set to
  `now + included_months` (e.g. "intro offer: CHF 100, 2 months incl.").

On a successful payment the webhook **updates the buyer's contact**:
`subscription_type_id`, `subscription_price_id`, `subscription_amount`,
`subscription_recurrence`, `membership_expiration`, `last_payment_at`, plus an
`activity_log` entry. The contact is resolved by `metadata.contactId` (preferred) or a
unique email match. Managers create a payment link from the **Payments dashboard →
"Create payment link"** (pick type + price + member email).

## Functions

| Function | Type | Who | What |
|---|---|---|---|
| `startConnectOnboarding` | callable | owner | Create the connected account (once) + return a hosted Account Link URL. |
| `getConnectStatus` | callable | owner | Refresh status from Stripe, persist, return charges/payouts enabled + outstanding requirements. |
| `createMembershipPayment` | callable | manager+ | Sell a subscription type + price → routes recurring/one-off, links the contact on payment. |
| `createMemberPayment` | callable | manager+ | Ad-hoc one-off direct-charge Checkout Session (+ `application_fee_amount`). |
| `createMemberSubscription` | callable | manager+ | Ad-hoc subscription Checkout Session (+ `application_fee_percent`). |
| `createMembershipCheckout` / `createProductCheckout` / `createCourseCheckout` | callable (public) | anyone | Member self-checkout from the public shop (email only). |
| `refundMemberPayment` | callable | manager+ | Refund a charge, reversing the platform fee proportionally. |
| `updatePaymentRecord` | callable | manager+ | (Re)assign the contact + edit the comment (shared with BYO). |
| `handleConnectWebhook` | onRequest (public) | Stripe | Verify + reconcile account / payment / subscription / refund / dispute state + contact membership. |

> Same-session redirect targets (Checkout success/cancel, Account Link return/refresh)
> are built from the **caller's origin** when it's a trusted Linyup/localhost origin
> (`resolveBaseUrl`, `utils/env.ts`), so local dev returns to localhost; otherwise they
> fall back to the env-configured `HOSTING_URL`.

### Data model

- `connect_accounts/{stripeAccountId}` — top-level, keyed by `acct_...` so the webhook
  resolves `event.account → teamId` with one `.get()`. Mirror on `teams/{teamId}.payments`.
- `teams/{teamId}/member_payments/{paymentIntentId}` — one-off charges + refunds (+ `comment`).
- `teams/{teamId}/member_subscriptions/{subscriptionId}` — recurring memberships.
- `connect_webhook_events/{eventId}` — idempotency markers (functions only).

All are **function-written only**; managers/owners get read access for the dashboard.

## Public shop (member self-checkout)

A public, member-facing page at **`/public/{slug}/shop`** lists the team's public
subscription types, products, and `purchase`-tier courses, and lets a member pay
without logging in (email only). It reads the world-readable
`aggregator_subscription_types` catalogue (incl. price `id` + `included_months`) and
calls the **public** `createMembershipCheckout` / `createProductCheckout` /
`createCourseCheckout` callables (unauthenticated; same Connect kill-switch +
chargeable-account guards + an IP/hour rate limit). On success the
`checkout.session.completed` webhook **links or creates** the buyer's contact from the
Stripe `customer_details` — cap-aware: on a Free team at the 15-contact limit the
contact is not created (payment is still recorded). Stripe redirects to
`/{locale}/pay/result`.

Entry points: a **bio-link** "Shop" system link (auto-shown once Connect is enabled,
owner-toggleable) and the **website pricing** component (each plan card deep-links
`/public/{slug}/shop?type={id}`, plus a "view all" link). The `shop` segment is a
reserved slug.

## Webhook setup

The Connect endpoint must receive **connected-account** events. With the Stripe CLI,
forward Connect events to the local emulator (note `--forward-connect-to`):

```bash
stripe listen \
  --forward-connect-to "http://localhost:5001/demo-linyup/europe-west6/handleConnectWebhook"
```

Copy the printed `whsec_...` into `STRIPE_CONNECT_WEBHOOK_SECRET` and restart the
Functions emulator. In production, register a **Connect** webhook endpoint pointing at
`https://europe-west6-<project>.cloudfunctions.net/handleConnectWebhook` and subscribe to:

```
account.updated, capability.updated, v2.core.account*  (account state)
checkout.session.completed                              (links/creates the buyer's contact)
payment_intent.succeeded, payment_intent.payment_failed
charge.refunded, charge.dispute.created, charge.dispute.closed
customer.subscription.created/updated/deleted
invoice.paid, invoice.payment_failed
```

## Test instructions

1. Enable the flag on a test team (`payments.connectEnabled = true`).
2. Call `startConnectOnboarding({ teamId, model: 'managed' })` → open the returned URL,
   complete Stripe's **test** onboarding (use the "skip / use test data" affordances).
3. Call `getConnectStatus({ teamId })` → expect `charges_enabled: true` once card_payments
   is `active`.
4. **One-off:** `createMemberPayment({ teamId, amount: 2500, purpose: 'drop_in' })` → pay with
   test card `4242 4242 4242 4242`. The `payment_intent.succeeded` event writes
   `member_payments/{pi}` with the `application_fee_amount`.
5. **Subscription:** `createMemberSubscription({ teamId, amount: 5000, interval: 'month' })` →
   pay → `customer.subscription.created` + `invoice.paid` write `member_subscriptions/{sub}`.
   Use **test clocks** to advance renewals.
6. **Refund:** `refundMemberPayment({ teamId, paymentIntentId })` → `charge.refunded` reconciles
   `amount_refunded` + `status`; the application fee is reversed proportionally.
7. **Dispute:** trigger `charge.dispute.created` (e.g. card `4000 0000 0000 0259`) → status
   surfaces on the payment doc.

Unit tests for the fee calculation: `pnpm --filter @linyup/functions test`
(`computePlatformFee` / `applyTakeRate`). Build `@linyup/shared` first.

### Validate in test mode (status)

Confirmed against Stripe test mode (2026-06-19, run via the guarded integration suite):

- ✅ **Account configuration accepted** — Standard account creation (full dashboard,
  `fees_collector: 'stripe'`, `losses_collector: 'stripe'`, `card_payments` + `twint_payments`
  capabilities) is accepted once Connect + Accounts v2 are enabled on the platform. The
  express/embedded Managed variant was **rejected** ("account configuration is not supported")
  — hence the single Standard config above.
- ✅ **"Use my existing account" + onboarding link** — the `dashboard: 'full'` Account Link
  lets a studio sign into an existing Stripe account or create a new one (both framings).
- ✅ **Direct charge + refund** — one-off direct charge with `application_fee_amount`, then a
  partial refund with proportional fee reversal, both succeed on the connected account.
- ✅ **Enablement derivation** — on a fully-onboarded account, `normalizeAccount()` correctly
  produced `status: enabled`, `charges_enabled: true`, `payouts_enabled: true`; on a restricted
  account it surfaces the exact `requirements_currently_due` list for the finish-setup UI.
  (Test mode permits charges on a still-`restricted` account; production blocks them, which
  `requireChargeableAccount` enforces by gating on `enabled`.)
- ✅ **TWINT capability** — after full KYC onboarding, `twint_payments` flips to `active`
  alongside `card_payments`, confirming TWINT works under direct charges + Connect.
- ⏳ **TWINT recurring** — the only remaining manual check: the **one-active-mandate-per-
  studio↔member** behavior on subscriptions needs a real TWINT Checkout payment (redirect-based,
  so not server-automatable).

## Out of scope (Phase 1)

Multi-currency / EUR payouts, custom payout scheduling, instant payouts, split-cart
marketplace checkouts, becoming a Payment Facilitator or Merchant of Record.

---

# Rail B — BYO gateway (record-only)

A studio that runs its **own** payment gateway (Payrexx, or its own Stripe account)
keeps all the money (no platform fee). Linyup's role is deliberately **minimal**: it
**records** each confirmed payment and links it to a contact. Linyup does not run the
checkout, manage refunds, or hold any gateway credentials — only the per-team **webhook
signing secret**, used to verify signatures.

> Want Linyup to run the checkout, handle refunds, and take a platform fee? Use
> **Rail A (Connect)** above — a different rail.

Each team configures exactly one gateway at
`teams/{teamId}/integrations/{integrationId}` (type `payment_gateway`).

| Gateway | Webhook handler | Status |
|---------|----------------|--------|
| Payrexx | `handlePayrexxWebhook` | ✅ Implemented |
| Stripe (BYO) | `handleTeamStripeWebhook` | ✅ Implemented (record-only) |

Matching, Unassigned handling, the `comment` field, and the unified payments page are
shared with Connect — see **Unified payments view** above.

## The BYO ledger — `teams/{teamId}/payment_events/{gateway}:{gatewayRef}`

The unified `ExternalPayment` record. Written atomically by the webhook handlers on
first delivery, and patched by `updatePaymentRecord` when a manager (re)assigns the
contact or edits the comment. Write-once on the webhook side — a redelivery (and any
later manager edit) is never clobbered.

```jsonc
{
  "gateway": "payrexx",            // "payrexx" | "stripe"
  "gatewayRef": "12345",           // Payrexx tx id / Stripe payment ref
  "contact_id": "…",               // null when unassigned
  "assignment_status": "assigned", // "assigned" | "unassigned"
  "amount": 5000,                  // smallest currency unit (Rappen / Cent)
  "currency": "CHF",
  "email": "student@example.com",  // payer email, may be null
  "subscription_type_id": "…",     // may be null
  "membership_expiration": Timestamp, // may be null
  "comment": "Monthly membership", // "what was paid" — default suggestion, editable
  "raw_status": "confirmed",
  "processed_at": Timestamp,
  "assigned_by": "uid",            // set when a manager assigns
  "assigned_at": Timestamp
}
```

**Firestore rules:** managers and owners can read; no client writes (the
`updatePaymentRecord` callable writes via the Admin SDK).

The payment is **always recorded** (even when no contact matches) so nothing is
silently dropped. The contact record is updated only when uniquely **assigned**:
`membership_expiration` ← gateway date, `subscription_type_id` ← referenceId/metadata
or the gateway default, `last_payment_at` ← now.

## Payrexx

### Setup

1. **Settings → Payments → Add gateway → Payrexx.** Enter the instance name (your
   Payrexx subdomain) + currency.
2. In your Payrexx dashboard → **Settings → Webhooks → Add webhook**:

   | Field | Value |
   |-------|-------|
   | URL | `https://europe-west6-linyup-prod.cloudfunctions.net/handlePayrexxWebhook?teamId=YOUR_TEAM_ID` |
   | Events | `Transaction` |
   | Secret | A random string — paste it into Linyup's **Webhook signing secret** field |

   *(Staging: replace `linyup-prod` with `linyup-staging`. Local: see Testing below.)*
3. Optionally set a **Default subscription type** — applied when a payment link has no
   `referenceId`. Set `referenceId` to the subscription-type ID on each Payrexx link for
   per-plan control. Resolution order: `transaction.referenceId` → gateway default → none.

### Behaviour

- **Signature**: `HMAC-SHA256(rawBody, signingSecret)` compared to `X-Webhook-Signature`
  with a constant-time comparison. Blank secret → logs a warning and allows through
  (setup phase only; **not** for production).
- Only `status: confirmed` is processed; `mode: TEST` is ignored unless
  `ALLOW_TEST_PAYREXX=true`.
- **Membership expiration** comes from `transaction.subscription.valid_until` (parsed as
  end-of-day UTC). One-off payments have none.
- Idempotent on `payment_events/payrexx:{transactionId}` — duplicate deliveries are
  acknowledged with `200`.

## Stripe (BYO)

A studio charging on its **own** Stripe account. Handler:
`handleTeamStripeWebhook?teamId={teamId}`.

### Setup

1. **Settings → Payments → Add gateway → Stripe.** Enter the publishable key + currency.
   (Stored for reference; BYO makes no Stripe API calls.)
2. In the **Stripe dashboard → Developers → Webhooks**, add an endpoint:

   | Field | Value |
   |-------|-------|
   | URL | `https://europe-west6-linyup-prod.cloudfunctions.net/handleTeamStripeWebhook?teamId=YOUR_TEAM_ID` |
   | Events | `checkout.session.completed`, `payment_intent.succeeded`, `invoice.payment_succeeded` |

3. Copy the endpoint's **Signing secret** (`whsec_…`) into the Linyup gateway dialog's
   **Webhook signing secret** field. Without it, no payments are recorded.
4. Optionally set a **Default subscription type** — applied when a payment carries no
   `metadata.subscriptionTypeId`.

### Behaviour

- **Signature** is verified against the team's own signing secret
  (`stripe.webhooks.constructEventAsync`). No Stripe API key is needed.
- Keyed by the underlying **payment reference** (PaymentIntent / invoice / session id),
  so `checkout.session.completed` and the matching `payment_intent.succeeded` converge to
  **one** `payment_events` doc (write-once).
- Scope is **record + assign** only — no in-app checkout, no refunds (those happen in the
  studio's own Stripe dashboard, or use Connect).

## BYO — webhook behaviour (shared)

- **Always 200** after signature verification, so the gateway stops retrying for
  expected conditions (misconfigured team, no contact match, …). Only genuine server
  errors return 5xx.
- **Idempotency** via the `payment_events/{gateway}:{ref}` doc id (atomic create-or-skip).

## BYO — testing locally

### Payrexx — curl against the local emulator

```bash
BODY='{"transaction":{"id":99999,"status":"confirmed","mode":"LIVE","referenceId":"YOUR_SUB_TYPE_ID","contact":{"email":"student@example.com"},"subscription":{"valid_until":"2027-01-31"}}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "YOUR_SECRET" | awk '{print $2}')
curl -X POST \
  "http://localhost:5001/demo-linyup/europe-west6/handlePayrexxWebhook?teamId=YOUR_TEAM_ID" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

Expected: `{"ok":true,"contact_id":"…","assignment_status":"assigned"}` (or
`unassigned` when no single contact matches). Then check the Firestore emulator UI at
[localhost:4000](http://localhost:4000) for the `payment_events` doc + contact updates.

### Stripe (BYO) — Stripe CLI

```bash
stripe listen \
  --forward-to "http://localhost:5001/demo-linyup/europe-west6/handleTeamStripeWebhook?teamId=YOUR_TEAM_ID"
```

Paste the printed `whsec_…` into the team's gateway config, then `stripe trigger
checkout.session.completed` (or pay a test Checkout on the studio's own test account).

## BYO — troubleshooting

| Log message | Fix |
|-------------|-----|
| `No Payrexx integration for team=…` / `no_integration` | Gateway not configured, or wrong `teamId` in the webhook URL |
| `Missing X-Webhook-Signature` / `missing_signature` | The gateway isn't sending the header — check its webhook config |
| `Signature mismatch` / `invalid_signature` | The signing secret in Linyup doesn't match the gateway's. Re-copy it. |
| `… unassigned email=…` | No single active contact matched (none, or a shared family email) — recorded as **Unassigned**; assign it from the Payments page. |
| `skipped_status:…` (Payrexx) | Payment not confirmed yet — normal; the gateway sends events at each status change. |
| `test_mode` (Payrexx) | `mode: TEST` — set `ALLOW_TEST_PAYREXX=true` on staging, or use a live payment. |
| `already_processed` / `duplicate` | A retried/previously-processed event — safe to ignore. |
