# Testing Billing Locally (Stripe Test Mode)

All billing tests run against Stripe's **test mode** — no real money moves.
The full stack runs locally: Firebase emulators (auth + firestore + functions)
+ Next.js dev server + Stripe CLI webhook forwarding.

---

## One-time setup

### 1. Install the Stripe CLI

```
# Windows (winget)
winget install Stripe.StripeCLI

# macOS (Homebrew)
brew install stripe/stripe-cli/stripe
```

Authenticate once:
```
stripe login
```

### 2. Get your Stripe test keys

Go to [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys).
Make sure the **Test mode** toggle (top-right) is ON.

Copy the **Secret key** — it starts with `sk_test_`.

### 3. Create Stripe prices (test mode)

In the Stripe dashboard → **Products** → create one product per plan with a
recurring monthly price. Set the **Lookup key** exactly as shown:

| Plan         | Lookup key                  |
|--------------|-----------------------------|
| Coach        | `lineup_coach_monthly`      |
| Club         | `lineup_club_monthly`       |
| Organization | `lineup_organization_monthly` |

The lookup key is how `createCheckoutSession` (Cloud Function) resolves the
price — no price IDs are hardcoded in the codebase.

### 4. Fill in `packages/functions/.env.local`

This file is gitignored. Open it and replace the placeholders:

```env
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_FILL_AFTER_STEP_5
HOSTING_URL=http://localhost:3000
```

`STRIPE_WEBHOOK_SECRET` comes from `stripe listen` (step 5 below). You only
know it after starting the CLI the first time, so fill it in then.

---

## Each dev session

### Terminal 1 — start everything

```
pnpm dev:billing
```

This script:
1. Builds Cloud Functions (required by the Functions emulator)
2. Starts Firebase emulators: auth (:9099), firestore (:8080), functions (:5001)
3. Seeds the emulator with 3 test accounts
4. Starts the Next.js dev server (:3000)

### Terminal 2 — forward Stripe webhooks

Wait until "emulators up" appears in Terminal 1, then:

```
pnpm stripe:listen
```

The CLI prints a signing secret like:
```
> Ready! Your webhook signing secret is whsec_abc123... (^C to quit)
```

Copy that `whsec_...` value → paste it into `packages/functions/.env.local`
as `STRIPE_WEBHOOK_SECRET` → restart Terminal 1.

> You only need to do the copy-paste the first time. The `whsec_` value stays
> the same for the same `stripe login` session, so subsequent sessions can
> skip the restart.

---

## Test accounts (seeded)

| Email                 | Password    | Plan         | Status  |
|-----------------------|-------------|--------------|---------|
| `coach@lineup.dev`    | `lineup123` | Coach        | Trial   |
| `club@lineup.dev`     | `lineup123` | Club         | Active  |
| `org@lineup.dev`      | `lineup123` | Organization | Active  |

---

## Test scenarios

### Successful subscription upgrade

1. Sign in as `coach@lineup.dev`
2. Sidebar → **Billing** (or **Upgrade** → "Upgrade to this plan")
3. Click **Select Plan: Club**
4. Stripe Checkout opens — use test card:
   - Number: `4242 4242 4242 4242`
   - Expiry: any future date (e.g. `12/34`)
   - CVC: any 3 digits
5. Complete payment → redirected back to `/billing?checkout=success`
6. Page shows: **Club · Active · Next billing: ...**

Watch Terminal 2 — you'll see `customer.subscription.created` and
`invoice.payment_succeeded` events forwarded to the local function.

### Payment failure

Use card `4000 0000 0000 0002` at checkout.  
Stripe declines it → `invoice.payment_failed` fires → subscription goes to
`past_due`.

### 3D Secure / authentication required

Use card `4000 0025 0000 3155`.  
Stripe shows a 3DS prompt → complete it → payment succeeds.

### Cancel subscription

1. Sign in as `club@lineup.dev` (already active)
2. Billing → "Cancel at end of period"
3. Confirm → `cancel_at_period_end: true` set on subscription
4. Badge shows: **Cancels on [date]**

### Trigger a webhook manually

```
stripe trigger customer.subscription.created
```

Other useful triggers:
```
stripe trigger invoice.payment_succeeded
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted
```

---

## Inspect state

| Tool | URL | What to check |
|------|-----|---------------|
| Firestore emulator UI | [localhost:4000](http://localhost:4000) | `saas_subscriptions/{teamId}` doc |
| Stripe dashboard (test) | [dashboard.stripe.com/test](https://dashboard.stripe.com/test) | Customers, subscriptions, events |
| Terminal 2 (stripe listen) | — | Forwarded events + HTTP response codes |
| Next.js dev server logs | Terminal 1 | Function errors surfaced as console output |

---

## Troubleshooting

**"Secret 'stripe-secret-key' not found in env"**  
→ `FUNCTIONS_EMULATOR=true` is set but `STRIPE_SECRET_KEY` is missing from
`packages/functions/.env.local`. Add it.

**"No Stripe price found for lookup key: lineup_club_monthly"**  
→ The price doesn't exist in your test Stripe account. Create it in the
dashboard with the exact lookup key shown in the table above.

**Webhook shows 400 / signature verification failed**  
→ `STRIPE_WEBHOOK_SECRET` in `.env.local` doesn't match what `stripe listen`
printed. Copy the `whsec_...` value fresh from Terminal 2 and restart.

**Billing page calls fail silently in the browser**  
→ Make sure you're running `pnpm dev:billing`, not `pnpm dev:local`. The
`dev:local` script does not start the Functions emulator (:5001), so callable
functions have nothing to connect to.

**Functions emulator not starting**  
→ The emulator requires a compiled build. `dev:billing` runs the build
automatically, but if you change function code mid-session you need to rebuild:
```
pnpm --filter @lineup/functions run build
```
Then restart Terminal 1.
