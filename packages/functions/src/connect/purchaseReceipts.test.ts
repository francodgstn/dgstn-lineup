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

// ── UX-80: the same money, taken by hand ─────────────────────────────────────
// The offline sibling of the block above. What it guards is not "the mail stops
// going out" — a desk receipt is a CHOICE and may legitimately not be sent — but
// the two placements that would break the feature quietly:
//
//   1. the send migrating INTO `applyPaymentEffects`, which re-runs on every
//      manager edit and would mail the member again on each re-save;
//   2. the send migrating INTO `writeManualPaymentEvent`, which is shared with
//      rails that already confirm themselves (the appointments phone booking,
//      the gift-card till) and would give those buyers a second, worse mail.
//
// Both were live risks the finding named explicitly, and neither would fail a
// runtime test — the mail simply goes out more often than anyone intended.
describe('the DESK receipts confirm a sale made by hand', () => {
  const desk = read('payments/deskReceipt.ts')

  it('never lands in the shared effects function', () => {
    const effects = code(read('payments/effects.ts'))
    assert.equal(
      /sendEmail|Receipt\(/.test(effects),
      false,
      'payments/effects.ts re-runs on every manager edit — a send there mails on each re-save'
    )
  })

  it('never lands in the shared manual-payment writer', () => {
    const src = code(read('payments/recordManualPayment.ts'))
    const writer = src.slice(
      src.indexOf('export async function writeManualPaymentEvent'),
      src.indexOf('export const recordManualPayment')
    )
    assert.ok(writer.length > 0, 'the writer must still precede the callable')
    assert.equal(
      /sendDeskSaleReceipt/.test(writer),
      false,
      'staffBooking + the gift-card till share this writer and confirm themselves already'
    )
    assert.ok(
      /sendDeskSaleReceipt/.test(src.slice(src.indexOf('export const recordManualPayment'))),
      'the CALLABLE is where the studio ticked the box'
    )
  })

  it('sends only on an explicit opt-in — an omitted flag never mails', () => {
    for (const file of [
      'payments/recordManualPayment.ts',
      'connect/updatePayment.ts',
      'contacts/grantCredits.ts',
    ]) {
      assert.ok(
        /data\.sendReceipt === true/.test(code(read(file))),
        `${file} must require an explicit true, not a truthy default`
      )
    }
  })

  it('reuses the shop bodies rather than growing a fifth template', () => {
    for (const fn of [
      'sendMembershipPurchaseReceipt',
      'sendCoursePurchaseReceipt',
      'sendProductPurchaseReceipt',
    ]) {
      assert.ok(desk.includes(fn), `payments/deskReceipt.ts must delegate to ${fn}`)
    }
    assert.equal(
      /buildEmailTemplate|detailsBox/.test(code(desk)),
      false,
      'no template assembly here — the bodies live in connect/purchaseTemplates.ts'
    )
  })

  it('never claims a cash membership renews itself', () => {
    // There is no Stripe subscription behind a manual payment, so the recurring
    // copy would promise a billing portal this member has no access to.
    assert.equal(
      /recurring:\s*true/.test(code(desk)),
      false,
      'a manual payment creates no subscription — recurring must stay false'
    )
  })

  it('names the tender, so a bare amount cannot read as a card charge', () => {
    assert.ok(code(desk).includes('methodLabel'))
    assert.ok(
      code(read('connect/purchaseTemplates.ts')).includes('methodLabel'),
      'the facts line must render it'
    )
  })

  it('does not thank somebody for a purchase they did not make', () => {
    assert.ok(
      code(desk).includes('granted: true'),
      'the grantCredits rail must swap the purchase copy'
    )
  })

  it('is named in the census of what sits outside the toggles', () => {
    assert.ok(
      read('utils/systemEmails.ts').includes('payments/deskReceipt.ts'),
      'utils/systemEmails.ts owns that list — say why this one is a choice, not a toggle'
    )
  })

  it('a double-click grants once and mails once', () => {
    const grant = code(read('contacts/grantCredits.ts'))
    assert.ok(grant.includes('grantRef.create('), 'a deterministic id must be created, not set')
    assert.ok(grant.includes('duplicate'), 'the second click must be reported, not applied')
    const manual = code(read('payments/recordManualPayment.ts'))
    assert.ok(
      /!result\.duplicate/.test(manual),
      'a duplicated manual payment re-applies nothing, so it must re-announce nothing'
    )
  })
})

// ── UX-79: a product can finally say how to get it ───────────────────────────
describe('the product receipt states the studio’s collection terms', () => {
  it('resolves them through the ONE shared resolver', () => {
    const receipts = code(read('connect/purchaseReceipts.ts'))
    assert.ok(
      receipts.includes('resolveProductCollectionNote'),
      'the receipt must resolve product-note→team-default the same way the shop does'
    )
  })

  it('replaces the generic line rather than joining it', () => {
    const tpl = code(read('connect/purchaseTemplates.ts'))
    assert.ok(
      tpl.includes('collectionNote ?? nextLines[lang]'),
      "the studio's own terms must not be printed beside a platform disclaimer"
    )
  })

  it('reaches both online product rails', () => {
    assert.ok(/productId: md\.productId/.test(code(read('connect/webhook.ts'))))
    const payments = code(read('connect/payments.ts'))
    assert.ok(/itemLabel: productName,\s+productId,/.test(payments))
  })
})
