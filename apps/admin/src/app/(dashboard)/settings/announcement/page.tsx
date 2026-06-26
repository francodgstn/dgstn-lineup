import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAnnouncementStatus } from '@/lib/queries/settings'
import { formatDate } from '@/lib/format'
import { requireOperator } from '@/lib/require-operator'
import { AnnouncementForm } from './announcement-form'

export const dynamic = 'force-dynamic'

export default async function AnnouncementSettingsPage() {
  const [announcement] = await Promise.all([getAnnouncementStatus(), requireOperator()])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Announcement</CardTitle>
        <CardDescription>
          Controls the platform-wide announcement banner shown across the web app as a top strip
          (e.g. &ldquo;This is a demo — data resets periodically&rdquo; on the sandbox env). The
          banner is read from the world-readable settings doc, so it also appears on public routes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <AnnouncementForm
          initialEnabled={announcement.enabled}
          initialText={announcement.text ?? ''}
          initialStyle={announcement.style}
        />
        <div className="border-t pt-3 text-xs text-muted-foreground">
          {announcement.updatedMs
            ? `Last changed ${formatDate(announcement.updatedMs)}${
                announcement.updatedBy ? ` by ${announcement.updatedBy}` : ''
              }.`
            : 'Never changed.'}
        </div>
      </CardContent>
    </Card>
  )
}
