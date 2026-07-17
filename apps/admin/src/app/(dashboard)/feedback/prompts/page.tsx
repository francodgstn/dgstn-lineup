import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { requireOperator } from '@/lib/require-operator'
import { listPrompts } from '@/lib/queries/feedback'
import type { FeedbackPromptStatus } from '@linyup/shared'
import { PromptForm } from './prompt-form'
import { PromptRowActions } from './prompt-row-actions'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<FeedbackPromptStatus, 'secondary' | 'success' | 'outline'> = {
  draft: 'secondary',
  active: 'success',
  closed: 'outline',
}

export default async function FeedbackPromptsPage() {
  const [prompts] = await Promise.all([listPrompts(), requireOperator()])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>New prompt question</CardTitle>
          <CardDescription>
            Ask app users something specific. Created as a draft; pushing it makes it appear in the
            feedback widget of every signed-in user, who can answer or mute it. Answers land in the
            inbox. Note: prompt content is readable by any signed-in user (drafts too) — keep it
            non-sensitive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PromptForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prompts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {prompts.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">No prompts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Answers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Pushed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prompts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-96">
                      <p className="truncate font-medium">{p.question}</p>
                      <p className="text-xs text-muted-foreground">
                        {[p.allowRating && 'rating', p.allowText && 'text']
                          .filter(Boolean)
                          .join(' + ')}
                        {p.createdBy ? ` · by ${p.createdBy}` : ''}
                      </p>
                    </TableCell>
                    <TableCell>{p.answerCount}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[p.status]}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(p.createdMs)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(p.activatedMs)}
                    </TableCell>
                    <TableCell>
                      <PromptRowActions id={p.id} status={p.status} />
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
