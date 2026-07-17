// Ops email notification for new in-app feedback submissions.
//
// Fires on every feedback/{id} create. Reads the notification config FRESH
// from app_settings/global_settings on each event — deliberately NOT via
// getAppSettings(): that helper module-caches forever (an ops toggle would
// stale until instance recycle) and throws when the doc is missing (a fresh
// project/emulator has none). Missing doc / disabled flag / empty recipient
// list ⇒ silently skip, never fail the trigger.
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  APP_SETTINGS_COLLECTION,
  GLOBAL_SETTINGS_DOC,
  FEEDBACK_PROMPTS_COLLECTION,
  type FeedbackDoc,
} from '@linyup/shared'
import { sendEmail, buildEmailTemplate, idempotencyKey } from '../utils/email'
import { detailsBox, factLines } from '../utils/emailLayout'
import { escapeHtml } from '../utils/html'

export const onFeedbackCreated = onDocumentCreated('feedback/{feedbackId}', async (event) => {
  const snap = event.data
  if (!snap) return
  const feedback = snap.data() as FeedbackDoc
  const db = admin.firestore()

  // Prompt-answer bookkeeping first (independent of the notify config): bump
  // the prompt's answer counter and fetch the question text for the email.
  let promptQuestion: string | null = null
  if (feedback.prompt_id) {
    const promptRef = db.collection(FEEDBACK_PROMPTS_COLLECTION).doc(feedback.prompt_id)
    try {
      const promptSnap = await promptRef.get()
      promptQuestion = (promptSnap.data()?.question as string | undefined) ?? null
      await promptRef.set({ answer_count: FieldValue.increment(1) }, { merge: true })
    } catch (error) {
      console.error(`[onFeedbackCreated] prompt bookkeeping failed for ${feedback.prompt_id}:`, error) // eslint-disable-line no-console
    }
  }

  const settingsSnap = await db.collection(APP_SETTINGS_COLLECTION).doc(GLOBAL_SETTINGS_DOC).get()
  const settings = settingsSnap.exists ? (settingsSnap.data() ?? {}) : {}
  const notifyEnabled = settings.feedback_notify_enabled === true
  const notifyEmails = Array.isArray(settings.feedback_notify_emails)
    ? (settings.feedback_notify_emails as string[]).filter((e) => typeof e === 'string' && e.includes('@'))
    : []
  if (!notifyEnabled || notifyEmails.length === 0) {
    console.log(`[onFeedbackCreated] ${event.params.feedbackId}: notifications ${notifyEnabled ? 'enabled but no recipients' : 'disabled'} — skipping email`) // eslint-disable-line no-console
    return
  }

  const rating = typeof feedback.rating === 'number'
    ? `${'★'.repeat(feedback.rating)}${'☆'.repeat(5 - feedback.rating)} ${feedback.rating}/5`
    : null
  const scopes = feedback.scopes?.length ? feedback.scopes.join(', ') : 'general'

  const facts = factLines([
    rating ? `<strong>Rating:</strong> ${rating}` : '',
    promptQuestion ? `<strong>Question:</strong> ${escapeHtml(promptQuestion)}` : '',
    `<strong>Scope:</strong> ${escapeHtml(scopes)}`,
    `<strong>Team:</strong> ${escapeHtml(feedback.team_name)} (${escapeHtml(feedback.team_id)}) · ${escapeHtml(feedback.plan)} plan`,
    `<strong>From:</strong> ${escapeHtml(feedback.created_by_email)}`,
    `<strong>Page:</strong> ${escapeHtml(feedback.context?.path ?? '')}${feedback.context?.title ? ` — ${escapeHtml(feedback.context.title)}` : ''}`,
    `<strong>Client:</strong> ${escapeHtml(feedback.context?.viewport ?? '')} · ${escapeHtml(feedback.context?.locale ?? '')}`,
    `<strong>Screenshot:</strong> ${feedback.screenshot_path ? 'attached' : 'none'}`,
  ])
  const messageBlock = feedback.message
    ? `<p style="margin:16px 0 0 0;white-space:pre-wrap;">${escapeHtml(feedback.message)}</p>`
    : ''
  const body = `
    ${detailsBox({
      title: feedback.type === 'prompt_answer' ? 'Prompt answer' : 'New feedback',
      content: facts + messageBlock,
    })}
    <p>Review it in the ops console → Feedback.</p>
  `

  const teamHint = feedback.team_name ? ` — ${feedback.team_name}` : ''
  const subject = feedback.type === 'prompt_answer'
    ? `Feedback: prompt answer${teamHint}`
    : `Feedback: new submission${rating ? ` (${feedback.rating}/5)` : ''}${teamHint}`
  const { html, text } = buildEmailTemplate({ title: 'In-app feedback', body })

  try {
    // System mail (no teamId) from hello@linyup.com; idempotent per feedback doc.
    await sendEmail({
      to: notifyEmails,
      subject,
      html,
      text,
      tags: ['feedback-notify'],
      idempotencyKey: idempotencyKey('feedback-notify', event.params.feedbackId),
    })
  } catch (error) {
    // Never let a mail failure retry the trigger (the counter increment above
    // is not idempotent across retries).
    console.error(`[onFeedbackCreated] notification email failed for ${event.params.feedbackId}:`, error) // eslint-disable-line no-console
  }
})
