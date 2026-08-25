/* eslint-disable no-console */
// Platform notices — Linyup writing to its Customers, with a record of it.
//
// The DPA (§4.5) promises 20 days' notice before a sub-processor changes, and
// §3.12 promises six weeks before the terms do. Until this shipped, both were
// commitments whose only evidence would have been somebody's sent-items folder.
//
// TWO CALLABLES, AND THE FIRST ONE MATTERS MORE THAN IT LOOKS.
// `previewPlatformNotice` resolves the audience and returns the count and a
// sample WITHOUT sending. A send to "all" is irreversible and outward-facing;
// the operator should see the number before it happens, not after.
//
// THE RECIPIENT LIST IS RESOLVED ONCE AND STORED. Never re-derived — see the
// header of shared/types/platformNotice.ts for why.
//
// INTERNAL TENANTS ARE EXCLUDED, through the same `tenantHiddenFromPlatformMetrics`
// predicate the metrics sweep uses. The demo tenant and the app-store review
// studio are ours; mailing them a legal notice is noise in the ledger and
// confusion for whoever opens the inbox.

import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  PLATFORM_NOTICES_COLLECTION,
  PLATFORM_NOTICE_RECIPIENTS_SUBCOLLECTION,
  TEAMS_COLLECTION,
  TEAM_MEMBERS_SUBCOLLECTION,
  USERS_COLLECTION,
  platformNoticeAudienceProblem,
  platformNoticePlaceholderProblem,
  renderNoticeText,
  tenantHiddenFromPlatformMetrics,
  type PlatformNoticeAudience,
  type PlatformNoticeTemplateId,
  type SaasPlan,
} from '@linyup/shared'
import { requireOperator } from '../utils/operator'
import { sendSystemMail } from '../mail/mailService'
import { buildEmailTemplate } from '../utils/email'

/** A send fans out one mail per address. Well above any plausible tenant count
 *  today, and a ceiling rather than a silent truncation: past it the callable
 *  refuses and says so. */
const MAX_RECIPIENTS = 2000

interface ResolvedTeam {
  teamId: string
  teamName: string
  plan: SaasPlan | null
  emails: string[]
}

function parseAudience(raw: unknown): PlatformNoticeAudience {
  const a = (raw ?? {}) as PlatformNoticeAudience
  if (a.kind !== 'all' && a.kind !== 'plans' && a.kind !== 'teams') {
    throw new HttpsError('invalid-argument', 'audience.kind must be all, plans or teams')
  }
  const problem = platformNoticeAudienceProblem(a)
  if (problem) throw new HttpsError('invalid-argument', problem)
  return a
}

/**
 * Turn an audience into the studios it names, each with the addresses to mail.
 *
 * Owners always. Managers only when asked — a maintenance window concerns
 * whoever runs the day; a contract change concerns whoever signed it.
 */
async function resolveAudience(
  audience: PlatformNoticeAudience,
  includeManagers: boolean
): Promise<ResolvedTeam[]> {
  const db = admin.firestore()

  // The team set is read whole and filtered in memory. `flags.internal` is a
  // nested field with no top-level boolean to query on (the metrics sweep hit
  // this first), and the created-date narrowing is an optional second axis that
  // would otherwise need its own composite index for every plan combination.
  const snap =
    audience.kind === 'teams'
      ? await db.getAll(
          ...(audience.teamIds ?? []).map((id) => db.collection(TEAMS_COLLECTION).doc(id))
        )
      : (await db.collection(TEAMS_COLLECTION).get()).docs

  const candidates = snap.filter((d) => {
    if (!d.exists) return false
    const t = d.data() as Record<string, unknown>
    if (tenantHiddenFromPlatformMetrics(t.flags as never)) return false
    // A studio already scheduled for deletion is still a Customer until it is
    // purged, so it is NOT excluded — a notice during its wind-down window is
    // exactly when it is owed one.
    if (audience.kind === 'plans') {
      const plan = (t.plan ?? 'free') as SaasPlan
      if (!(audience.plans ?? []).includes(plan)) return false
    }
    const createdMs = (t.created as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
    if (audience.createdBefore != null && !(createdMs < audience.createdBefore)) return false
    if (audience.createdAfter != null && !(createdMs >= audience.createdAfter)) return false
    return true
  })

  const out: ResolvedTeam[] = []
  for (const doc of candidates) {
    const t = doc.data() as Record<string, unknown>
    const members = await db
      .collection(TEAMS_COLLECTION)
      .doc(doc.id)
      .collection(TEAM_MEMBERS_SUBCOLLECTION)
      .get()

    const wanted = members.docs.filter((m) => {
      const role = m.data()?.role
      return role === 'owner' || (includeManagers && role === 'manager')
    })
    // Owner first, so the stored list reads in the order the DPA describes.
    wanted.sort((a, b) => (a.data()?.role === 'owner' ? -1 : b.data()?.role === 'owner' ? 1 : 0))

    const uids = wanted.map((m) => String(m.data()?.userId ?? m.id)).filter(Boolean)
    const userDocs = uids.length
      ? await db.getAll(...uids.map((uid) => db.collection(USERS_COLLECTION).doc(uid)))
      : []

    const emails: string[] = []
    for (const u of userDocs) {
      const email = u.exists ? String(u.data()?.email ?? '').trim() : ''
      if (email && !emails.includes(email.toLowerCase())) emails.push(email)
    }

    out.push({
      teamId: doc.id,
      teamName: String(t.name ?? doc.id),
      plan: (t.plan ?? null) as SaasPlan | null,
      emails,
    })
  }
  return out
}

/** Resolve and report, without sending. */
export const previewPlatformNotice = onCall(async (request) => {
  requireOperator(request)
  const data = (request.data ?? {}) as {
    audience?: PlatformNoticeAudience
    includeManagers?: boolean
  }
  const audience = parseAudience(data.audience)
  const teams = await resolveAudience(audience, data.includeManagers === true)

  const recipientCount = teams.reduce((n, t) => n + t.emails.length, 0)
  const unreachable = teams.filter((t) => t.emails.length === 0)

  return {
    teamCount: teams.length,
    recipientCount,
    // Named, not just counted: a studio with no reachable address is a studio
    // that will NOT be notified, and the operator has to see which before
    // sending rather than discover it in the outcome.
    unreachable: unreachable.map((t) => ({ teamId: t.teamId, teamName: t.teamName })),
    sample: teams.slice(0, 10).map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      plan: t.plan,
      emails: t.emails,
    })),
    overLimit: recipientCount > MAX_RECIPIENTS,
    limit: MAX_RECIPIENTS,
  }
})

/** Resolve, record, send, and record what happened. */
export const sendPlatformNotice = onCall({ timeoutSeconds: 540 }, async (request) => {
  const operator = requireOperator(request)
  const data = (request.data ?? {}) as {
    subject?: string
    body?: string
    templateId?: PlatformNoticeTemplateId
    audience?: PlatformNoticeAudience
    includeManagers?: boolean
    values?: Record<string, string>
  }

  const subject = typeof data.subject === 'string' ? data.subject.trim() : ''
  const body = typeof data.body === 'string' ? data.body.trim() : ''
  if (!subject) throw new HttpsError('invalid-argument', 'A subject is required')
  if (!body) throw new HttpsError('invalid-argument', 'A body is required')

  // THE SERVER REFUSES AN UNSUBSTITUTED NOTICE, not just the composer. The
  // failure this prevents is a customer reading "takes effect on
  // {{effective_date}}", and a UI-only guard is one stale tab away from it.
  const values = (data.values ?? {}) as Record<string, string>
  const placeholderProblem = platformNoticePlaceholderProblem(subject, body, values)
  if (placeholderProblem) throw new HttpsError('invalid-argument', placeholderProblem)

  const audience = parseAudience(data.audience)
  const includeManagers = data.includeManagers === true
  const teams = await resolveAudience(audience, includeManagers)

  const recipientCount = teams.reduce((n, t) => n + t.emails.length, 0)
  if (recipientCount === 0) {
    throw new HttpsError('failed-precondition', 'That audience resolves to nobody.')
  }
  if (recipientCount > MAX_RECIPIENTS) {
    throw new HttpsError(
      'resource-exhausted',
      `That audience is ${recipientCount} recipients, over the ${MAX_RECIPIENTS} limit.`
    )
  }

  const db = admin.firestore()
  const noticeRef = db.collection(PLATFORM_NOTICES_COLLECTION).doc()

  // Written BEFORE the fan-out, at `sending`. If the callable dies mid-send the
  // notice is still on record with its audience — a half-sent notice that left
  // no trace is the outcome this whole feature exists to prevent.
  await noticeRef.set({
    subject,
    body,
    templateId: data.templateId ?? 'blank',
    audience,
    includeManagers,
    values,
    status: 'sending',
    created_by: operator,
    created_at: FieldValue.serverTimestamp(),
    team_count: teams.length,
    recipient_count: recipientCount,
  })

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const team of teams) {
    // Rendered PER STUDIO, not once: recipient-scoped variables ({{studio_name}},
    // {{plan}}) resolve differently for each. The operator's values are merged
    // underneath them, so a notice using neither renders identically for
    // everyone at the cost of a little repeated work.
    const scoped = { ...values, studio_name: team.teamName, plan: team.plan ?? 'free' }
    const renderedSubject = renderNoticeText(subject, scoped).text
    const renderedBody = renderNoticeText(body, scoped).text

    // Both halves: `buildEmailTemplate` returns the branded HTML and a plain-text
    // twin derived from it. Sending HTML alone is what puts a legal notice in a
    // spam folder.
    const { html, text } = buildEmailTemplate({
      title: renderedSubject,
      body: renderedBody
        .split('\n\n')
        .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join(''),
      footer: 'You are receiving this because you run a studio on Linyup.',
    })

    const mailSendIds: string[] = []
    let outcome: 'sent' | 'skipped' | 'failed' | 'no_recipient' = 'no_recipient'
    let error: string | null = null

    if (team.emails.length === 0) {
      // Recorded rather than dropped: "we could not reach this studio" is an
      // answer an audit needs, and it is invisible if the row is absent.
      outcome = 'no_recipient'
    } else {
      for (const email of team.emails) {
        try {
          const result = await sendSystemMail({
            to: email,
            subject: renderedSubject,
            html,
            text,
            tags: ['platform-notice'],
            // Deterministic per notice per address: a retry of this callable
            // refreshes rather than mails the same studio twice.
            idempotencyKey: `platform-notice:${noticeRef.id}:${email.toLowerCase()}`,
          })
          if (result.skipped) {
            skipped += 1
            if (outcome !== 'sent') outcome = 'skipped'
          } else {
            sent += 1
            outcome = 'sent'
          }
          if (result.providerMessageId) mailSendIds.push(result.providerMessageId)
        } catch (err) {
          failed += 1
          outcome = 'failed'
          error = err instanceof Error ? err.message : String(err)
          console.error(`[notice] ${noticeRef.id} -> ${team.teamId} failed`, err)
        }
      }
    }

    await noticeRef
      .collection(PLATFORM_NOTICE_RECIPIENTS_SUBCOLLECTION)
      .doc(team.teamId)
      .set({
        teamId: team.teamId,
        teamName: team.teamName,
        plan: team.plan,
        emails: team.emails,
        mailSendIds,
        outcome,
        error,
        resolved_at: FieldValue.serverTimestamp(),
      })
  }

  await noticeRef.update({
    status: failed > 0 && sent === 0 ? 'failed' : 'sent',
    sent_at: FieldValue.serverTimestamp(),
    recipient_count: sent,
    skipped_count: skipped,
    failed_count: failed,
  })

  console.log(
    `[notice] ${noticeRef.id} teams=${teams.length} sent=${sent} skipped=${skipped} failed=${failed}`
  )
  return { noticeId: noticeRef.id, teamCount: teams.length, sent, skipped, failed }
})
