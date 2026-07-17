import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { requireOperator } from '@/lib/require-operator'
import { getFeedback, getPromptQuestions } from '@/lib/queries/feedback'
import { StatusActions } from './status-actions'

export const dynamic = 'force-dynamic'

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [row] = await Promise.all([getFeedback(id), requireOperator()])
  if (!row) notFound()

  const promptQuestion = row.promptId
    ? (await getPromptQuestions([row.promptId]))[row.promptId] ?? null
    : null

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'Submitted', value: formatDateTime(row.createdMs) },
    { label: 'Type', value: row.type === 'prompt_answer' ? 'Prompt answer' : 'General' },
    ...(promptQuestion ? [{ label: 'Question', value: promptQuestion }] : []),
    { label: 'Rating', value: row.rating != null ? `${row.rating}/5` : '—' },
    {
      label: 'Scope',
      value:
        row.scopes.length === 0 ? (
          'general'
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.scopes.map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </span>
        ),
    },
    { label: 'Team', value: `${row.teamName || '—'} (${row.teamId}) · ${row.plan} plan` },
    { label: 'From', value: row.createdByEmail },
    {
      label: 'Page',
      value: row.context ? `${row.context.path}${row.context.title ? ` — ${row.context.title}` : ''}` : '—',
    },
    {
      label: 'Client',
      value: row.context ? `${row.context.viewport} · ${row.context.locale}` : '—',
    },
    ...(row.context?.user_agent ? [{ label: 'User agent', value: row.context.user_agent }] : []),
    ...(row.reviewedMs
      ? [
          {
            label: 'Reviewed',
            value: `${formatDateTime(row.reviewedMs)}${row.reviewedBy ? ` by ${row.reviewedBy}` : ''}`,
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/feedback"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Inbox
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            Feedback
            <Badge
              variant={row.status === 'new' ? 'default' : row.status === 'reviewed' ? 'success' : 'secondary'}
            >
              {row.status}
            </Badge>
          </CardTitle>
          <StatusActions id={row.id} status={row.status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {row.message && (
            <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              {row.message}
            </p>
          )}

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            {facts.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt className="font-medium text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>

          {row.screenshotPath && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">Screenshot</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/feedback/screenshot?path=${encodeURIComponent(row.screenshotPath)}`}
                alt="Feedback screenshot"
                className="max-w-full rounded-lg border"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
