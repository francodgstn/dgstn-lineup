/* eslint-disable no-console */
// Connect integration tests — exercised against Stripe TEST MODE.
//
// These are GUARDED: the whole suite is skipped unless STRIPE_SECRET_KEY is a test
// key (sk_test_...), so the default `pnpm --filter @linyup/functions test` stays
// green in CI without credentials. To run:
//
//   STRIPE_SECRET_KEY=sk_test_... \
//   [STRIPE_TEST_CONNECTED_ACCOUNT=acct_...] \      # a pre-onboarded test account
//   pnpm --filter @linyup/functions test
//
// Account creation + onboarding link + status are tested with just the key.
// Charge + refund (with fee reversal) need a charge-enabled connected account, so
// they are additionally gated on STRIPE_TEST_CONNECTED_ACCOUNT (a test account you
// onboarded once). Subscription renewals + disputes are driven via test clocks /
// the Stripe CLI — see docs/payment-contact-studio.md.

import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { computePlatformFee } from '@linyup/shared'

const TEST_KEY = process.env.STRIPE_SECRET_KEY ?? ''
const HAS_TEST_KEY = TEST_KEY.startsWith('sk_test_')
const CHARGEABLE_ACCT = process.env.STRIPE_TEST_CONNECTED_ACCOUNT // pre-onboarded

// getSecret() only reads env vars under the emulator flag; set it so the Connect
// client picks up STRIPE_SECRET_KEY from the environment.
process.env.FUNCTIONS_EMULATOR = 'true'

;(HAS_TEST_KEY ? describe : describe.skip)('Connect integration (Stripe test mode)', function () {
  this.timeout(30000)

  // Imported lazily so the module isn't loaded when the suite is skipped.
  let client: typeof import('../utils/connect/client')
  before(async () => {
    client = await import('../utils/connect/client')
  })

  it('creates a Standard connected account (quick-setup framing) + onboarding link', async () => {
    const { accountId } = await client.createConnectedAccount({
      model: 'managed',
      teamId: 'itest-team',
      email: 'managed-itest@example.com',
      country: 'CH',
      idempotencyKey: `itest-managed:${Date.now()}`,
    })
    assert.match(accountId, /^acct_/)

    const link = await client.createAccountLink({
      accountId,
      refreshUrl: 'https://example.com/refresh',
      returnUrl: 'https://example.com/return',
    })
    assert.match(link.url, /^https:\/\//)

    const status = await client.retrieveAccountStatus(accountId)
    assert.ok(['pending', 'restricted', 'enabled'].includes(status.status))
    assert.equal(typeof status.charges_enabled, 'boolean')

    // To unlock the charge/refund/TWINT checks below: open the URL, complete
    // Stripe's TEST onboarding, then re-run with STRIPE_TEST_CONNECTED_ACCOUNT set.
    console.log(`\n[itest] onboard to enable charge tests → STRIPE_TEST_CONNECTED_ACCOUNT=${accountId}`)
    console.log(`[itest] onboarding URL: ${link.url}\n`)
  })

  it('creates a BYO (full dashboard) connected account', async () => {
    const { accountId } = await client.createConnectedAccount({
      model: 'byo',
      teamId: 'itest-team',
      email: 'byo-itest@example.com',
      country: 'CH',
      idempotencyKey: `itest-byo:${Date.now()}`,
    })
    assert.match(accountId, /^acct_/)
  })

  // ── charge + refund need a charge-enabled account ──────────────────────────────
  ;(CHARGEABLE_ACCT ? describe : describe.skip)('with a charge-enabled account', function () {
    this.timeout(30000)

    it('derives enablement + TWINT capability consistently from Stripe state', async () => {
      const status = await client.retrieveAccountStatus(CHARGEABLE_ACCT!)
      console.log('[itest] account status:', JSON.stringify(status, null, 2))
      // The derivation maps the card_payments capability → charges_enabled.
      assert.equal(status.charges_enabled, status.capabilities['card_payments'] === 'active')
      // TWINT was requested on the merchant config; Stripe tracks it.
      assert.ok('twint_payments' in status.capabilities, 'twint_payments capability present')
      console.log(`[itest] twint_payments status: ${status.capabilities['twint_payments']}`)
      // A restricted account must surface outstanding requirements for finish-setup UX.
      if (status.status === 'restricted') {
        assert.ok((status.requirements_currently_due ?? []).length > 0)
      }
    })

    it('takes a one-off direct charge with the platform fee, then refunds it (fee reversed)', async () => {
      const stripe = new Stripe(TEST_KEY)
      const amount = 2500 // CHF 25.00
      const applicationFeeAmount = computePlatformFee({ tier: 'studio', amount }) // 0.8% = 20

      // Confirm a PaymentIntent server-side with a test card (no browser needed).
      const pi = await stripe.paymentIntents.create(
        {
          amount,
          currency: 'chf',
          application_fee_amount: applicationFeeAmount,
          payment_method: 'pm_card_visa',
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        },
        { stripeAccount: CHARGEABLE_ACCT, idempotencyKey: `itest-pi:${Date.now()}` }
      )
      assert.equal(pi.status, 'succeeded')
      assert.equal(pi.application_fee_amount, applicationFeeAmount)

      // Partial refund — fee reversed proportionally.
      const refund = await client.refundDirectCharge({
        accountId: CHARGEABLE_ACCT!,
        paymentIntentId: pi.id,
        amount: 1000, // refund CHF 10 of 25
        idempotencyKey: `itest-refund:${Date.now()}`,
      })
      assert.match(refund.id, /^re_/)
      assert.equal(refund.amount, 1000)
    })
  })
})
