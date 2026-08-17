import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE ALWAYS-ON POSTURE ON THE RAILS THAT SELL, asserted against the source —
// the sibling of booking/paidConfirmation.test.ts, which pins the same rule on
// the rails that BOOK.
//
// A receipt for money is not a preference. UX-77 found three rails taking money
// and confirming nothing: a credit pack (the mail IS the balance), a course (the
// only thing that says where to watch it) and a product (the only thing that
// says what happens next). The failure mode this file guards is not "the mail
// stops going out" — it is a later reader tidying these behind a `SystemEmailKey`
// "for consistency" with the free booking confirmation, which would put the
// silence back.
//
// It reads the TypeScript SOURCE rather than importing the modules: importing
// the webhook pulls in firebase-functions and the Stripe client, and the claim
// under test is about which gate a call site consults and which module a call
// site calls — both properties of the text. Same technique as
// connect/commitSites.test.ts.

const SRC = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
}

/** CODE only — the module headers below discuss the toggles and the stale
 *  rollup at length, and counting prose as a call site is the confusion this
 *  avoids. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('the SHOP purchase receipts are always on', () => {
  const receipts = read('connect/purchaseReceipts.ts')

  it('consult no system-email toggle, ever', () => {
    assert.equal(
      /systemEmailEnabled/.test(code(receipts)),
      false,
      'connect/purchaseReceipts.ts must not gate on a SystemEmailKey — see its header'
    )
  })

  it('say WHY in the header, and point at the rule they inherit', () => {
    assert.ok(receipts.includes('ALWAYS ON'), 'the posture must be stated')
    assert.ok(
      receipts.includes('booking/paidConfirmation.ts'),
      'the header must point at the rule it inherits'
    )
    assert.ok(
      receipts.includes('booking/waitlist/notify.ts'),
      'the header must point at the precedent that rule came from'
    )
  })

  it('are idempotent through the mail_sends ledger, keyed to the tender', () => {
    for (const key of ['purchase-membership-', 'purchase-course-', 'purchase-product-']) {
      assert.ok(
        new RegExp(`idempotencyKey:\\s*\`${key}`).test(receipts),
        `the ${key} send must carry a ledger key`
      )
    }
    assert.ok(receipts.includes('tenderRef'), 'the keys must be per payment, not per person-and-thing')
  })

  it('never throw — the money has already moved', () => {
    // Each exported sender wraps its whole body; a `throw` reaching the webhook
    // would become a 5xx and make Stripe re-run the grant logic.
    assert.equal((receipts.match(/\bthrow\b/g) ?? []).length, 0)
    assert.equal((receipts.match(/} catch \(err\) \{/g) ?? []).length >= 3, true)
  })

  it("read the credit balance from the GRANT, never from the contact's rollup", () => {
    // `Contact.credit_summary` is maintained by the onCreditGrantWrite trigger
    // and is eventually consistent — reading it here would report a stale number
    // in the one mail whose entire job is the number.
    assert.equal(
      /credit_summary/.test(code(receipts)),
      false,
      'the credit pack receipt must read credits_total off the grant it just wrote'
    )
    assert.ok(code(receipts).includes('credits_total'))
    assert.ok(code(receipts).includes('CONTACT_CREDIT_GRANTS_SUBCOLLECTION'))
  })

  it('are named in the census of what sits outside the toggles', () => {
    assert.ok(
      read('utils/systemEmails.ts').includes('connect/purchaseReceipts.ts'),
      'utils/systemEmails.ts owns the "NOT covered here (by design)" list — add to it'
    )
  })
})

describe('every rail that takes money in the SHOP sends one', () => {
  // Named, not counted. Two tenders reach a shop purchase and only one of them
  // has a webhook: a gift card covering the WHOLE price creates no Stripe
  // session at all, so `connect/payments.ts`'s full-cover branches are the only
  // place those sales can confirm themselves. That is the exact hole UX-76 found
  // one rail over, which is why it is pinned here rather than remembered.
  const SENDERS: Record<string, { fn: string; what: string }[]> = {
    'connect/webhook.ts': [
      { fn: 'sendMembershipPurchaseReceipt(', what: 'handleCheckoutCompleted, membership branch' },
      { fn: 'sendCoursePurchaseReceipt(', what: 'handleCourseCheckout' },
      { fn: 'sendProductPurchaseReceipt(', what: 'handleProductCheckout' },
    ],
    'connect/payments.ts': [
      { fn: 'sendCoursePurchaseReceipt(', what: 'createCourseCheckout, gift-card full cover' },
      { fn: 'sendProductPurchaseReceipt(', what: 'createProductCheckout, gift-card full cover' },
    ],
  }

  it('each call site sends its rail’s receipt', () => {
    for (const [file, sites] of Object.entries(SENDERS)) {
      const src = code(read(file))
      for (const site of sites) {
        assert.ok(src.includes(site.fn), `${file} (${site.what}) must send the receipt`)
      }
    }
  })
})
