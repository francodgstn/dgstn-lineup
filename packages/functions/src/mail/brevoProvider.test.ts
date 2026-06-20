import assert from 'node:assert/strict'
import type { BrevoClient } from '@getbrevo/brevo'
import { __setBrevoClientForTests } from './brevoClient'
import { brevoProvider } from './brevoProvider'

// Captures the request handed to Brevo so we can assert the mapping without a key.
interface Captured {
  req: Record<string, unknown> | null
}

function stubClient(captured: Captured): BrevoClient {
  return {
    transactionalEmails: {
      async sendTransacEmail(req: Record<string, unknown>) {
        captured.req = req
        return { messageId: 'msg-123' }
      },
    },
  } as unknown as BrevoClient
}

describe('brevoProvider', () => {
  const captured: Captured = { req: null }

  beforeEach(() => {
    captured.req = null
    __setBrevoClientForTests(stubClient(captured))
  })
  afterEach(() => __setBrevoClientForTests(null))

  it('maps sender, recipients, reply-to and the idempotency header', async () => {
    const res = await brevoProvider.send(
      { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>', idempotencyKey: 'k1' },
      { name: 'HMD Basel', email: 'studios@linyup.com', replyTo: 'coach@hmd.ch' },
    )
    assert.equal(res.providerMessageId, 'msg-123')
    const req = captured.req!
    assert.deepEqual(req.sender, { name: 'HMD Basel', email: 'studios@linyup.com' })
    assert.deepEqual(req.to, [{ email: 'a@b.com' }])
    assert.deepEqual(req.replyTo, { email: 'coach@hmd.ch' })
    assert.equal(req.htmlContent, '<p>x</p>')
    assert.deepEqual(req.headers, { 'Idempotency-Key': 'k1' })
  })

  it('supports multiple recipients and lets a message reply-to override the sender', async () => {
    await brevoProvider.send(
      { to: ['a@b.com', 'c@d.com'], subject: 's', text: 't', replyTo: 'override@x.com' },
      { name: 'N', email: 'e@e.com', replyTo: 'sender-default@x.com' },
    )
    const req = captured.req!
    assert.deepEqual(req.to, [{ email: 'a@b.com' }, { email: 'c@d.com' }])
    assert.deepEqual(req.replyTo, { email: 'override@x.com' })
    assert.equal(req.headers, undefined) // no idempotency key → no headers
  })

  it('base64-encodes attachments', async () => {
    await brevoProvider.send(
      { to: 'a@b.com', subject: 's', text: 't', attachments: [{ filename: 'invite.ics', content: 'BEGIN:VCAL' }] },
      { name: 'N', email: 'e@e.com' },
    )
    const att = (captured.req!.attachment as { name: string; content: string }[])[0]
    assert.equal(att.name, 'invite.ics')
    assert.equal(att.content, Buffer.from('BEGIN:VCAL', 'utf8').toString('base64'))
  })
})
