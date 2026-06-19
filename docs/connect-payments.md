# Stripe Connect — member → studio payments

> **Scope:** this lets a studio/coach collect payments **from their members**
> (memberships, drop-ins, belt-test fees, shop) directly inside Linyup, with
> Linyup taking a configurable platform fee. Money settles on the **studio's**
> Stripe balance — it never passes through or settles into Linyup's own balance.
> CHF-first (Phase 1), with TWINT.

This is the **third, distinct** payment concern in the codebase — keep them apart:

| Concern | Money settles on | Where |
|---|---|---|
| Linyup SaaS billing (platform charges studios) | **Linyup** | `saas-billing/`, `getPlatformStripeAdapter()` |
| BYO team gateway (studio charges members, **independent** account, no fee) | Studio | `utils/gateway/`, `handlePayrexxWebhook` |
| **Connect (this doc)** — studio charges members **+ platform fee** | **Studio** | `connect/`, `utils/connect/` |

---

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
- **CHF only** in Phase 1. All money is **integer Rappen** — never floats.
- Feature-flagged per team (`teams/{teamId}.payments.connectEnabled`) so it ships dark.

### The three §6 decisions (final values)

1. **Fee-payer →** the **studio pays Stripe fees** (`fees_collector: 'stripe'`);
   Linyup's application fee is clean margin and **losses are assigned to Stripe**
   (`losses_collector: 'stripe'`) — Linyup is never liable. To satisfy both, the account
   must use the full dashboard (Standard), so there is **one** account config (see above);
   the separate "Managed/express" account from the brief was dropped after test-mode
   confirmed the combination is unsupported.
2. **Per-tier take-rate (placeholders, pending final sign-off):**

   | Tier | Application fee |
   |---|---|
   | Free | 5% |
   | Coach | 3% |
   | Studio *(brief's "Club")* | 2% |
   | Organization | 1% |

   Config lives in `packages/shared/src/types/connect.ts` → `CONNECT_TAKE_RATE`
   (basis points + optional minimum fee). The **only** fee entry points are
   `computePlatformFee()` (one-off, returns Rappen) and `takeRatePercent()`
   (subscriptions, returns a percent). No fee is hardcoded anywhere else.
3. **TWINT + direct-charge + Connect — validate in test mode.** Documented constraint:
   only **one active TWINT mandate per studio↔member pair**. See "Validate in test mode".

---

## Liability (single Standard config — both framings)

| | Standard account (`dashboard: 'full'`) |
|---|---|
| Stripe processing fees | Studio (`fees_collector: 'stripe'`) |
| Negative balance / chargeback loss | Stripe (`losses_collector: 'stripe'`) |
| Requirements / KYC | Stripe-collected |
| Linyup liability | none |

Both onboarding framings ("use my account" / "create new") resolve to this one config.

---

## Required secrets / env vars

| Secret (Secret Manager id) | Env var (emulator) | Purpose |
|---|---|---|
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | Platform key — **reused** from SaaS billing. The Connect platform *is* Linyup's Stripe account. Prefer a **restricted key** with Connect write scope in prod. |
| `stripe-connect-webhook-secret` | `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for the **Connect** webhook endpoint (separate from `stripe-webhook-secret`, which is the SaaS-billing endpoint). |

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

---

## Enabling the feature for a studio

The feature is **off by default**. An operator (admin role) sets the flag — owners
cannot self-enable it (enforced in `firestore.rules`: the team `payments` map is
admin/function-only):

```
teams/{teamId}.payments.connectEnabled = true
```

---

## Functions

| Function | Type | Who | What |
|---|---|---|---|
| `startConnectOnboarding` | callable | owner | Create the connected account (once) + return a hosted Account Link URL. |
| `getConnectStatus` | callable | owner | Refresh status from Stripe, persist, return charges/payouts enabled + outstanding requirements. |
| `createMemberPayment` | callable | manager+ | One-off direct-charge Checkout Session (+ `application_fee_amount`). |
| `createMemberSubscription` | callable | manager+ | Subscription Checkout Session (+ `application_fee_percent`). |
| `refundMemberPayment` | callable | manager+ | Refund a charge, reversing the platform fee proportionally. |
| `handleConnectWebhook` | onRequest (public) | Stripe | Verify + reconcile account / payment / subscription / refund / dispute state. |

### Data model

- `connect_accounts/{stripeAccountId}` — top-level, keyed by `acct_...` so the webhook
  resolves `event.account → teamId` with one `.get()`. Mirror on `teams/{teamId}.payments`.
- `teams/{teamId}/member_payments/{paymentIntentId}` — one-off charges + refunds.
- `teams/{teamId}/member_subscriptions/{subscriptionId}` — recurring memberships.
- `connect_webhook_events/{eventId}` — idempotency markers (functions only).

All are **function-written only**; managers/owners get read access for the dashboard.

---

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
payment_intent.succeeded, payment_intent.payment_failed
charge.refunded, charge.dispute.created, charge.dispute.closed
customer.subscription.created/updated/deleted
invoice.paid, invoice.payment_failed
```

---

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

### Validate in test mode (report back)

Status of the checks flagged to confirm against Stripe test mode rather than guess:

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
  produced `status: enabled`, `charges_enabled: true`, `payouts_enabled: true` from the active
  capabilities + empty requirements; on a restricted account it surfaces the exact
  `requirements_currently_due` list for the finish-setup UI. (Test mode permits charges on a
  still-`restricted` account; production blocks them, which `requireChargeableAccount` enforces
  by gating on `enabled`.)
- ✅ **TWINT capability** — after full KYC onboarding, `twint_payments` flips to `active`
  alongside `card_payments`, confirming TWINT works under direct charges + Connect.
- ⏳ **TWINT recurring** — the only remaining manual check: the **one-active-mandate-per-
  studio↔member** behavior on subscriptions needs a real TWINT Checkout payment (redirect-based,
  so not server-automatable).

---

## Out of scope (Phase 1)

Multi-currency / EUR payouts, custom payout scheduling, instant payouts, split-cart
marketplace checkouts, becoming a Payment Facilitator or Merchant of Record.
