import assert from 'node:assert/strict'
import { ledgerRowSpendsKey } from './mailService'

// WHY THIS IS PINNED.
//
// The idempotency key is the `mail_sends` doc id, and it is derived from the
// MESSAGE — the same booking confirmation always produces the same key. So
// whatever a row means, it means forever: a state wrongly treated as terminal
// does not delay a send, it cancels it permanently, silently, with a log line
// that says "idempotent skip" as if everything worked.
//
// The rule is therefore about ONE question — did this message reach Brevo? A
// row that says it did must never be sent again. A row that says it did not
// must never stop a retry, because every reason it did not is a condition that
// somebody can fix: an operator flips a tenant policy back to `live`, a parent's
// mailbox comes off the suppression list, a seeded contact gets a real address.
// Fix the condition, and the send that follows has to actually go out.

describe('ledgerRowSpendsKey', () => {
  it('spends the key once the message reached the provider', () => {
    assert.equal(ledgerRowSpendsKey('sent'), true)
  })

  it('spends the key for every delivery outcome the webhook can write', () => {
    // These are facts about a message Brevo ACCEPTED. A bounce is not a reason
    // to send again — it is the result of having sent.
    for (const status of ['delivered', 'bounced', 'blocked', 'spam']) {
      assert.equal(ledgerRowSpendsKey(status), true, status)
    }
  })

  it('does NOT spend the key on a provider failure', () => {
    assert.equal(ledgerRowSpendsKey('failed'), false)
  })

  it('does NOT spend the key on a suppressed row', () => {
    // The regression this exists for: suppressed rows used to be terminal, so a
    // send dropped by a tenant policy or a dead-address entry could never be
    // retried after the cause was removed.
    assert.equal(ledgerRowSpendsKey('suppressed'), false)
  })

  it('spends the key when the row says nothing — a duplicate is the worse mistake', () => {
    assert.equal(ledgerRowSpendsKey(undefined), true)
    assert.equal(ledgerRowSpendsKey(null), true)
  })
})
