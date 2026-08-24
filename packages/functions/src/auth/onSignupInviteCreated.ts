// Sends the invite email when the operator console authorizes a new signup.
// The admin "Access" tab writes a signup_invites/{id} doc; this trigger turns it
// into a branded email pointing at the signup page. Decoupling the email from
// the admin server action keeps SMTP latency out of the operator's request.
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { sendEmail, buildEmailTemplate } from '../utils/email'
import { ctaButton } from '../utils/emailLayout'
import { getHostingUrl } from '../utils/env'
import { SIGNUP_INVITES_COLLECTION } from '@linyup/shared'

export const onSignupInviteCreated = onDocumentCreated(
  `${SIGNUP_INVITES_COLLECTION}/{inviteId}`,
  async (event) => {
    const snap = event.data
    if (!snap) return

    const data = snap.data() as { email?: string } | undefined
    const email = data?.email?.trim()
    if (!email) return

    const signupUrl = `${getHostingUrl()}/signup`
    const { html, text } = buildEmailTemplate({
      title: "You're invited to Linyup",
      body: `
        <p>You've been invited to create your Linyup account.</p>
        <p style="margin:16px 0;">${ctaButton(signupUrl, 'Create your account')}</p>
        <p>Please sign up using this email address: <strong>${email}</strong>.</p>
        <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
      `,
    })

    await sendEmail({ to: email, subject: "You're invited to Linyup", html, text })
  },
)
