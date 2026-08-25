import { Timestamp } from 'firebase-admin/firestore'
import {
  PLATFORM_NOTICES_COLLECTION,
  PLATFORM_NOTICE_RECIPIENTS_SUBCOLLECTION,
  type PlatformNotice,
} from '@linyup/shared'
import { adminDb } from '@/lib/firebase-admin'
import { requireOperator } from '@/lib/require-operator'
import { NoticeComposer } from './notice-composer'

// Settings → Notices. Linyup writing to its Customers, with a record of it.
//
// The history below is the point, not a nicety: the DPA promises 20 days'
// notice before a sub-processor changes and the Terms promise six weeks before
// they change, and a promise whose only evidence is a sent-items folder is not
// one. Each row links to the resolved recipient list that was stored at send
// time — see packages/shared/src/types/platformNotice.ts for why it is stored
// rather than re-derived.

export const dynamic = 'force-dynamic'

interface NoticeRow {
  id: string
  subject: string
  status: string
  sentAtMs: number | null
  createdBy: string
  teamCount: number
  recipientCount: number
  skippedCount: number
  failedCount: number
  audienceLabel: string
  recipients: { teamName: string; emails: string[]; outcome: string }[]
}

function audienceLabel(n: PlatformNotice): string {
  const a = n.audience
  const base =
    a.kind === 'all'
      ? 'All studios'
      : a.kind === 'plans'
        ? `Plans: ${(a.plans ?? []).join(', ')}`
        : `${(a.teamIds ?? []).length} studio(s)`
  const bits = [base]
  if (a.createdAfter) bits.push(`created ≥ ${new Date(a.createdAfter).toISOString().slice(0, 10)}`)
  if (a.createdBefore) bits.push(`created < ${new Date(a.createdBefore).toISOString().slice(0, 10)}`)
  if (n.includeManagers) bits.push('owners + managers')
  else bits.push('owners only')
  return bits.join(' · ')
}

async function loadNotices(): Promise<NoticeRow[]> {
  const snap = await adminDb
    .collection(PLATFORM_NOTICES_COLLECTION)
    .orderBy('created_at', 'desc')
    .limit(50)
    .get()

  const rows: NoticeRow[] = []
  for (const doc of snap.docs) {
    const n = doc.data() as PlatformNotice
    const recips = await doc.ref
      .collection(PLATFORM_NOTICE_RECIPIENTS_SUBCOLLECTION)
      .limit(500)
      .get()
    rows.push({
      id: doc.id,
      subject: n.subject,
      status: n.status,
      sentAtMs: (n.sent_at as Timestamp | null | undefined)?.toMillis?.() ?? null,
      createdBy: n.created_by,
      teamCount: n.team_count ?? 0,
      recipientCount: n.recipient_count ?? 0,
      skippedCount: n.skipped_count ?? 0,
      failedCount: n.failed_count ?? 0,
      audienceLabel: audienceLabel(n),
      recipients: recips.docs.map((r) => ({
        teamName: String(r.data()?.teamName ?? r.id),
        emails: (r.data()?.emails ?? []) as string[],
        outcome: String(r.data()?.outcome ?? ''),
      })),
    })
  }
  return rows
}

export default async function NoticesPage() {
  await requireOperator()
  const notices = await loadNotices()

  return (
    <div className="space-y-8">
      <NoticeComposer />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Sent notices</h2>
          <p className="text-sm text-muted-foreground">
            The record of what was sent, to whom, and when. This is the evidence behind the notice
            periods in the Terms and the DPA — keep it.
          </p>
        </div>

        {notices.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Nothing sent yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {notices.map((n) => (
              <li key={n.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{n.subject}</p>
                    <p className="text-xs text-muted-foreground">{n.audienceLabel}</p>
                  </div>
                  <span
                    className={
                      n.status === 'sent'
                        ? 'shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800'
                        : n.status === 'failed'
                          ? 'shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800'
                          : 'shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800'
                    }
                  >
                    {n.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {n.sentAtMs ? new Date(n.sentAtMs).toLocaleString() : '—'} · by {n.createdBy} ·{' '}
                  {n.teamCount} studios · {n.recipientCount} sent
                  {n.skippedCount > 0 && ` · ${n.skippedCount} skipped`}
                  {n.failedCount > 0 && ` · ${n.failedCount} failed`}
                </p>
                {n.recipients.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Who was notified ({n.recipients.length})
                    </summary>
                    <ul className="mt-2 space-y-0.5 pl-3">
                      {n.recipients.map((r, i) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="text-foreground">{r.teamName}</span> —{' '}
                          {r.emails.join(', ') || 'no reachable address'}{' '}
                          <span className="opacity-70">({r.outcome})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
