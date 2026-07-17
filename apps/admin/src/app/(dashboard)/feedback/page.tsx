import Link from 'next/link'
import { Camera, MessageSquareText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { requireOperator } from '@/lib/require-operator'
import { listFeedback } from '@/lib/queries/feedback'
import { cn } from '@/lib/utils'
import type { FeedbackStatus } from '@linyup/shared'

export const dynamic = 'force-dynamic'

const FILTERS: { key: string; label: string; status?: FeedbackStatus }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New', status: 'new' },
  { key: 'reviewed', label: 'Reviewed', status: 'reviewed' },
  { key: 'archived', label: 'Archived', status: 'archived' },
]

const STATUS_BADGE: Record<FeedbackStatus, 'default' | 'success' | 'secondary'> = {
  new: 'default',
  reviewed: 'success',
  archived: 'secondary',
}

export default async function FeedbackInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const params = await searchParams
  const filter = FILTERS.find((f) => f.key === params.status) ?? FILTERS[0]!
  const [rows] = await Promise.all([listFeedback({ status: filter.status }), requireOperator()])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/feedback' : `/feedback?status=${f.key}`}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              f.key === filter.key
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No feedback{filter.status ? ` with status “${filter.label.toLowerCase()}”` : ''} yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <Link href={`/feedback/${row.id}`} className="hover:underline">
                        {formatDateTime(row.createdMs)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {row.type === 'prompt_answer' ? (
                        <Badge variant="outline">
                          <MessageSquareText className="size-3" />
                          answer
                        </Badge>
                      ) : (
                        <Badge variant="secondary">general</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.rating != null ? `${row.rating}/5` : '—'}
                    </TableCell>
                    <TableCell className="max-w-72">
                      <Link href={`/feedback/${row.id}`} className="flex items-center gap-1.5 hover:underline">
                        {row.screenshotPath && (
                          <Camera className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{row.message ?? '—'}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-44 flex-wrap gap-1">
                        {row.scopes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">general</span>
                        ) : (
                          row.scopes.map((s) => (
                            <Badge key={s} variant="outline">
                              {s}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.teamName || row.teamId}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {row.createdByEmail}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[row.status]}>{row.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
