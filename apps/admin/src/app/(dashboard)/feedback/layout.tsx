import { FeedbackTabs } from './feedback-tabs'

export const metadata = { title: 'Feedback · Linyup Ops' }

export default function FeedbackLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          In-app feedback from web-app users: submissions inbox, pushed prompt questions, and the
          global widget switch.
        </p>
      </div>
      <FeedbackTabs />
      {children}
    </div>
  )
}
