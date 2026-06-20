import assert from 'node:assert/strict'
import { BrevoClient } from '@getbrevo/brevo'
import { __setBrevoClientForTests } from './brevoClient'
import { brevoProvider } from './brevoProvider'
import { getSenderDomainStatus } from './brevoDomains'

// Live integration tests against the real Brevo API. They only run when a key is
// present, so CI without credentials skips them entirely.
//
//   BREVO_API_KEY          – required to run any of these
//   BREVO_TEST_RECIPIENT   – an inbox you control; required for the send tests
//   BREVO_MANAGED_FROM     – a verified linyup.com sender (default studios@linyup.com)
//   BREVO_SYSTEM_FROM      – a verified linyup.com sender (default hello@linyup.com)
//   BREVO_TEST_BYO_DOMAIN  – a verified BYO domain + its From, e.g. info@theirdojo.ch,
//                            given as the full address; enables the BYO send test
//
// Tip: enable Brevo "sandbox mode" on the API key to avoid delivering real mail.
const KEY = process.env.BREVO_API_KEY
const RECIPIENT = process.env.BREVO_TEST_RECIPIENT
const SYSTEM_FROM = process.env.BREVO_SYSTEM_FROM || 'hello@linyup.com'
const MANAGED_FROM = process.env.BREVO_MANAGED_FROM || 'studios@linyup.com'
const BYO_FROM = process.env.BREVO_TEST_BYO_DOMAIN // full address, e.g. info@theirdojo.ch

const suite = KEY ? describe : describe.skip
const sendSuite = KEY && RECIPIENT ? describe : describe.skip

suite('Brevo integration (live)', function () {
  this.timeout(30000)

  before(() => {
    __setBrevoClientForTests(new BrevoClient({ apiKey: KEY as string, maxRetries: 1 }))
  })
  after(() => __setBrevoClientForTests(null))

  sendSuite('transactional sends', () => {
    it('sends system mail (hello@linyup.com)', async () => {
      const res = await brevoProvider.send(
        { to: RECIPIENT as string, subject: 'Linyup integration — system', html: '<p>system</p>', tags: ['integration-test', 'system'] },
        { name: 'Linyup', email: SYSTEM_FROM },
      )
      assert.ok(res.providerMessageId)
    })

    it('sends managed studio mail (studio name over linyup.com, reply-to studio)', async () => {
      const res = await brevoProvider.send(
        { to: RECIPIENT as string, subject: 'Linyup integration — managed studio', html: '<p>managed</p>', tags: ['integration-test', 'managed'] },
        { name: 'Test Studio', email: MANAGED_FROM, replyTo: RECIPIENT as string },
      )
      assert.ok(res.providerMessageId)
    })

    const byoIt = BYO_FROM ? it : it.skip
    byoIt('sends from a verified BYO domain', async () => {
      const res = await brevoProvider.send(
        { to: RECIPIENT as string, subject: 'Linyup integration — BYO', html: '<p>byo</p>', tags: ['integration-test', 'byo'] },
        { name: 'Their Dojo', email: BYO_FROM as string, replyTo: RECIPIENT as string },
      )
      assert.ok(res.providerMessageId)
    })
  })

  it('reads domain status (BYO verification poll)', async function () {
    const domain = BYO_FROM ? (BYO_FROM.split('@')[1] as string) : process.env.BREVO_TEST_DOMAIN
    if (!domain) {
      this.skip()
      return
    }
    const status = await getSenderDomainStatus(domain)
    assert.equal(typeof status.authenticated, 'boolean')
    assert.ok(Array.isArray(status.dnsRecords))
  })
})
