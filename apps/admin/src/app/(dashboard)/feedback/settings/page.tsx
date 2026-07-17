import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { requireOperator } from '@/lib/require-operator'
import { getFeedbackSettings } from '@/lib/queries/feedback'
import { FeedbackSettingsForm } from './feedback-settings-form'

export const dynamic = 'force-dynamic'

export default async function FeedbackSettingsPage() {
  const [settings] = await Promise.all([getFeedbackSettings(), requireOperator()])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback settings</CardTitle>
        <CardDescription>
          Global switch for the in-app feedback widget (all tenants) and the per-feedback email
          notification to the ops team.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FeedbackSettingsForm
          initialEnabled={settings.enabled}
          initialNotifyEnabled={settings.notifyEnabled}
          initialNotifyEmails={settings.notifyEmails}
        />
        <div className="border-t pt-3 text-xs text-muted-foreground">
          {settings.enabledUpdatedMs
            ? `Last changed ${formatDate(settings.enabledUpdatedMs)}${
                settings.enabledUpdatedBy ? ` by ${settings.enabledUpdatedBy}` : ''
              }.`
            : 'Never changed.'}
        </div>
      </CardContent>
    </Card>
  )
}
