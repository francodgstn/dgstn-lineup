import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { sendEntityMail } from './mailService'
import { assertAccess, validateScope } from './domainAuth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Sends a test email AS the studio (team or org) so an owner/org-admin can verify
// their email-sending settings end-to-end. The recipient defaults to the caller's
// own account email; an explicit `to` overrides it. Uses the same sender
// resolution as real studio mail, so a verified BYO domain is exercised too.
export const sendTestEmail = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required')

  const { scope, entityId, to } = request.data ?? {}
  validateScope(scope, entityId)
  await assertAccess(request.auth.uid, scope, entityId)

  const fallback = request.auth.token.email
  const recipient = typeof to === 'string' && to.trim() ? to.trim() : fallback
  if (!recipient) {
    throw new HttpsError('failed-precondition', 'No recipient — your account has no email address; specify one.')
  }
  if (!EMAIL_RE.test(recipient)) {
    throw new HttpsError('invalid-argument', 'Enter a valid recipient email address')
  }

  const outcome = await sendEntityMail(
    scope,
    entityId,
    {
      to: recipient,
      subject: 'Linyup test email',
      html:
        '<p>This is a test email from <strong>Linyup</strong> confirming your email-sending settings work.</p>' +
        '<p>If you received this, your outbound mail is configured correctly.</p>',
      text:
        'This is a test email from Linyup confirming your email-sending settings work.\n\n' +
        'If you received this, your outbound mail is configured correctly.',
      tags: ['test'],
    },
    fallback,
  )

  return { success: true, sentTo: recipient, skipped: outcome.skipped ?? false, testMode: outcome.testMode ?? false }
})
