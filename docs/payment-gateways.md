# Payment Gateway Integration

> **Scope:** this document covers **team-level payment gateways** — the gateway
> a club uses to charge its own members and students. This is entirely separate
> from Linyup's SaaS billing (Linyup charging clubs for using the platform),
> which is documented in `docs/testing-billing.md`.

---

## What this is

Linyup lets each team plug in their **own** payment gateway (no platform fee —
money never touches Linyup) so they can:

- **Record** every confirmed payment against a contact, inside Linyup
- Have the contact record updated when a payment is uniquely matched
  (`membership_expiration`, `subscription_type_id`, `last_payment_at`)
- Keep an immutable audit trail of every payment event in Firestore

BYO is deliberately **minimal**: Linyup only records the payment and links it to a
contact. It does not run the checkout, manage refunds, or hold any gateway
credentials (only the per-team **webhook signing secret**, used to verify
signatures). For the fully-integrated rail with refunds + a platform fee, see
**Stripe Connect** ([connect-payments.md](connect-payments.md)).

**Matching is conservative.** Email is **not** a unique key — a parent's address
can control several child contacts — so a payment links to a contact only when
**exactly one** active contact matches the payer email. Zero or multiple matches
→ the payment is still **recorded as Unassigned**, and a manager assigns it from
the **Payments** page (or the contact's **Payments** tab). Each row also carries a
free-text **comment** ("what was paid"), prefilled with a default suggestion
(the subscription-type name or a generic gateway label) and editable by managers.

Each team configures exactly one gateway. The gateway settings live in
`teams/{teamId}/integrations/{integrationId}` (type `payment_gateway`).

**Supported gateways**

| Gateway | Webhook handler | Status |
|---------|----------------|--------|
| Payrexx | `handlePayrexxWebhook` | ✅ Implemented |
| Stripe (BYO) | `handleTeamStripeWebhook` | ✅ Implemented (record-only) |

---

## Architecture

```
External payment service
        │
        │  POST (signed)
        ▼
Cloud Function: handlePayrexxWebhook?teamId={teamId}
        │
        ├─ 1. Load integration config (Firestore, Admin SDK)
        ├─ 2. Verify HMAC-SHA256 signature
        ├─ 3. Parse transaction payload
        ├─ 4. Match contact by UNIQUE email (else → Unassigned)
        ├─ 5. Atomic Firestore transaction
        │       ├─ write payment_events doc (always; idempotency key)
        │       └─ update contact fields (only when assigned)
        └─ 6. Append activity_log entry (assigned only, best-effort)

Firestore writes:
  contacts/{contactId}
    └─ membership_expiration, subscription_type_id, last_payment_at

  teams/{teamId}/payment_events/payrexx:{transactionId}
    └─ immutable record (gateway, amount, email, processed_at, …)

  contacts/{contactId}/activity_log/{logId}
    └─ type: payment_received, source: payrexx, message: …
```

---

## Payrexx

### 1. Prerequisites

- A [Payrexx](https://payrexx.com) account with at least one payment form/link
- Your Payrexx **instance name** (the subdomain — e.g. `my-club` for
  `my-club.payrexx.com`)

### 2. Find your team ID

You need the Firestore team ID for the webhook URL. Fastest way: open any
authenticated page in Linyup, open browser DevTools → Application → Local
Storage → look for `teamId`, or copy it from the URL of the Settings page.

### 3. Configure the webhook in Payrexx

Go to your Payrexx dashboard → **Settings → Webhooks → Add webhook**.

| Field | Value |
|-------|-------|
| URL | `https://europe-west6-linyup-prod.cloudfunctions.net/handlePayrexxWebhook?teamId=YOUR_TEAM_ID` |
| Events | `Transaction` (covers payment confirmed, subscription renewed) |
| Secret | Generate or type a random string — you'll paste this into Linyup next |

> **Staging:** replace `linyup-prod` with `linyup-staging` and use the staging
> team ID.
>
> **Local dev:** see [Testing locally](#testing-locally) below.

Copy the **signing secret** you set. You'll need it in the next step.

### 4. Add the gateway in Linyup settings

1. Open **Settings → Payments** (team owner only)
2. Click **Add gateway** → select **Payrexx**
3. Fill in the fields:

   | Field | What to enter |
   |-------|--------------|
   | Instance name | Your Payrexx subdomain (e.g. `my-club`) |
   | Currency | 3-letter ISO code (e.g. `CHF`, `EUR`) |
   | Webhook signing secret | The secret you set in step 3 |
   | Default subscription type | Optional fallback (see [Subscription type mapping](#subscription-type-mapping)) |

4. Save. The gateway is now enabled.

### 5. Set up subscription type mapping

Each incoming payment needs to be associated with a Linyup **subscription
type** so the contact gets the right `membership_expiration` and plan.
There are two approaches — you can use both together:

#### A. Per-payment-link mapping (recommended)

In your Payrexx payment form/link settings, set the **Reference ID**
(`referenceId`) field to the Firestore ID of the Linyup subscription type.

To find a subscription type ID: Settings → Subscription types → copy the ID
shown under the type name (it is the Firestore document ID).

When the webhook fires, `transaction.referenceId` is matched directly to
`contacts/{contactId}.subscription_type_id`. This lets you have multiple
Payrexx payment links (e.g. monthly, annual, kids) each updating the correct
subscription type.

#### B. Gateway-level default

In the Linyup gateway settings dialog, select a **Default subscription type**.
This is applied when `transaction.referenceId` is blank (e.g. for payment
links that don't have it set, or one-off payments).

Resolution order: `transaction.referenceId` → gateway default → `null` (no
subscription type change, only `last_payment_at` updated).

### 6. Membership expiration

The contact's `membership_expiration` is set from `transaction.subscription.valid_until`
— a date string Payrexx includes for subscription payments (e.g. `"2026-12-31"`).
Linyup interprets this as end-of-day UTC (`2026-12-31T23:59:59Z`).

For one-off (non-subscription) payments, `valid_until` is absent and
`membership_expiration` is not touched — only `last_payment_at` is set.

---

## Webhook behaviour

### Always 200

The function always returns HTTP `200` — even for unknown endpoints, inactive
gateways, or contacts not found. This prevents Payrexx from triggering its
retry logic for expected conditions. Only genuine server errors (`500`) indicate
a problem that needs investigation.

### Idempotency

Before updating anything, the function writes a doc at:
```
teams/{teamId}/payment_events/payrexx:{transactionId}
```
This write is atomic (Firestore transaction). If Payrexx delivers the same
event twice (its normal retry behaviour), the second delivery finds the doc
already exists, logs `duplicate`, and returns `200` without touching the
contact again.

### Signature verification

The function computes `HMAC-SHA256(rawBody, signingSecret)` and compares it to
the `X-Webhook-Signature` header using a constant-time comparison
(`crypto.timingSafeEqual`) to prevent timing attacks.

If `webhook_signing_secret` is blank in the gateway config, the function logs a
warning and allows the request through. This is intentional for the initial
setup phase (before the secret is configured) but **should not remain that way
in production**.

### Test mode transactions

Transactions with `mode: "TEST"` are silently ignored by default. To allow
test transactions (e.g. in a staging environment), set the Cloud Function
environment variable `ALLOW_TEST_PAYREXX=true`.

---

## Testing locally

### Option A — ngrok tunnel (closest to production)

1. Install [ngrok](https://ngrok.com/download) and authenticate
2. Start the emulators (+ seed) in one terminal, and the web app in another:
   ```
   pnpm emulators:seed   # terminal 1 — incl. the Functions emulator on :5001
   pnpm dev:web          # terminal 2 — only if you need the UI to trigger payments
   ```
3. In another terminal, expose the local Functions emulator:
   ```
   ngrok http 5001
   ```
   ngrok prints a public URL like `https://abc123.ngrok.io`.
4. Set the Payrexx webhook URL to:
   ```
   https://abc123.ngrok.io/demo-linyup/europe-west6/handlePayrexxWebhook?teamId=YOUR_TEAM_ID
   ```
5. Use Payrexx test mode — trigger a test payment. The emulator receives it.

### Option B — curl against the local emulator

Skip the Payrexx dashboard entirely and POST a signed payload directly:

```bash
# Build the raw body
BODY='{"transaction":{"id":99999,"status":"confirmed","mode":"LIVE","referenceId":"YOUR_SUB_TYPE_ID","contact":{"email":"student@example.com"},"subscription":{"valid_until":"2027-01-31"}}}'

# Compute signature (replace YOUR_SECRET with what's in the Linyup settings)
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "YOUR_SECRET" | awk '{print $2}')

# POST to local emulator
curl -X POST \
  "http://localhost:5001/demo-linyup/europe-west6/handlePayrexxWebhook?teamId=YOUR_TEAM_ID" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

Expected response: `{"ok":true,"contact_id":"…"}`

Check the Firestore emulator UI at [localhost:4000](http://localhost:4000):
- `contacts/{contactId}`: `membership_expiration`, `subscription_type_id`, `last_payment_at` updated
- `teams/{teamId}/payment_events/payrexx:99999`: audit doc written
- `contacts/{contactId}/activity_log/…`: activity entry added

---

## Firestore data reference

### `teams/{teamId}/integrations/{integrationId}`

Written by the settings UI (owner only).

```jsonc
{
  "type": "payment_gateway",
  "teamId": "…",
  "enabled": true,
  "config": {
    "type": "payrexx",
    "instance_name": "my-club",
    "currency": "CHF",
    "webhook_signing_secret": "…",       // optional but strongly recommended
    "default_subscription_type_id": "…"  // optional fallback
  },
  "created": Timestamp,
  "createdBy": "uid",
  "updated_at": Timestamp
}
```

**Firestore rules:** only owners can read or write integrations.

### `teams/{teamId}/payment_events/{gateway}:{gatewayRef}`

The unified **BYO ledger** (`ExternalPayment`). Written atomically by
`handlePayrexxWebhook` / `handleTeamStripeWebhook` on first delivery, and patched
by the `updatePaymentRecord` callable when a manager (re)assigns the contact or
edits the comment. The webhook part is idempotent — a redelivery (and any later
manager edit) is never clobbered.

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

### `contacts/{contactId}` — fields updated on payment

| Field | Source |
|-------|--------|
| `membership_expiration` | `transaction.subscription.valid_until` (end-of-day UTC) |
| `subscription_type_id` | `transaction.referenceId` → gateway default → unchanged |
| `last_payment_at` | server timestamp (always set on confirmed payment) |

---

## Troubleshooting

**Contact not updated after a test payment**

Check the Cloud Function logs for `[handlePayrexxWebhook]` lines. Common causes:

| Log message | Fix |
|-------------|-----|
| `No Payrexx integration for team=…` | Gateway not configured in Settings, or wrong `teamId` in the webhook URL |
| `Missing X-Webhook-Signature` | Payrexx is not sending the header — check webhook config in Payrexx dashboard |
| `Signature mismatch` | `webhook_signing_secret` in Linyup doesn't match what's in Payrexx. Re-copy it. |
| `… unassigned email=…` | No single active contact matched the payer email (none, or a shared family email). The payment is recorded as **Unassigned** — assign it from the Payments page. |
| `skipped_status:waiting` | Payment not yet confirmed — normal, Payrexx sends events at each status change |
| `test_mode` | `mode: "TEST"` — set `ALLOW_TEST_PAYREXX=true` on staging or trigger a live payment |
| `already_processed` (duplicate) | Payrexx retried a previously processed event — safe to ignore |

**Duplicate payments updating the contact**

This cannot happen. The `payment_events/payrexx:{transactionId}` idempotency
guard is an atomic Firestore transaction — even if the function runs twice
concurrently, only one write succeeds.

**`membership_expiration` not set**

Either `transaction.subscription` is absent (one-off payment, not a
subscription) or `valid_until` could not be parsed. Check the raw Payrexx
payload in the Cloud Function logs.

**Webhook URL gives 405 Method Not Allowed**

The webhook URL must be POSTed to. If you test it in a browser (GET), you'll
get a 405 — that's correct behaviour.

---

## Stripe (BYO)

A studio that already runs **its own** Stripe account (no platform fee, money
never touches Linyup) can have Linyup **record** those payments against contacts —
the same minimal "record + assign" deal as Payrexx. Handler:
`handleTeamStripeWebhook?teamId={teamId}`.

> Want Linyup to run the checkout, handle refunds, and take a platform fee
> instead? Use **Stripe Connect** ([connect-payments.md](connect-payments.md)) —
> that is a different rail. BYO Stripe here is record-only.

### Setup

1. **Settings → Payments → Add gateway → Stripe.** Enter the publishable key and
   currency. (The publishable key is only stored for reference; BYO makes no
   Stripe API calls.)
2. In the **Stripe dashboard → Developers → Webhooks**, add an endpoint:

   | Field | Value |
   |-------|-------|
   | URL | `https://europe-west6-linyup-prod.cloudfunctions.net/handleTeamStripeWebhook?teamId=YOUR_TEAM_ID` |
   | Events | `checkout.session.completed`, `payment_intent.succeeded`, `invoice.payment_succeeded` |

3. Copy the endpoint's **Signing secret** (`whsec_…`) and paste it into the
   Linyup gateway dialog's **Webhook signing secret** field. Without it, no
   payments are recorded (the signature can't be verified).
4. Optionally set a **Default subscription type** — applied when a payment carries
   no `subscriptionTypeId` metadata. Set `metadata.subscriptionTypeId` on a
   Checkout Session / PaymentIntent for per-plan control.

### Behaviour

- **Signature** is verified against the team's own signing secret
  (`stripe.webhooks.constructEventAsync`). No Stripe API key is needed.
- The payment is keyed by its underlying **payment reference** (PaymentIntent /
  invoice / session id), so the `checkout.session.completed` and matching
  `payment_intent.succeeded` events converge to **one** `payment_events` doc
  (write-once — a redelivery or a manager's later edit is never clobbered).
- The payer email is matched with the same UNIQUE-match rule as Payrexx; no match
  (or ambiguous) → recorded **Unassigned**.
- Scope is **record + assign** only — no in-app checkout, no refunds (refunds
  happen in the studio's own Stripe dashboard, or use Connect).
