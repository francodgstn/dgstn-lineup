import { onSchedule } from 'firebase-functions/v2/scheduler'
import { markNoShowBookings } from './markNoShowBookings'
import { autoArchiveTrialContacts } from './autoArchiveTrialContacts'
import { resetExpiredStreaks } from './resetExpiredStreaks'
import { resetMonthlyScores } from './resetMonthlyScores'
import { sendBookingReminders } from './sendBookingReminders'


interface TaskResult {
  name: string
  status: 'success' | 'error'
  result?: unknown
  error?: string
}

// Run daily at 03:00 CET (02:00 UTC; DST-safe because tasks are idempotent)
export const dailyTasks = onSchedule(
  { schedule: 'every day 02:00', timeZone: 'UTC', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    console.log('Daily tasks started at:', new Date().toISOString()) // eslint-disable-line no-console

    const tasks: Array<{ name: string; handler: () => Promise<unknown> }> = [
      { name: 'markNoShowBookings', handler: markNoShowBookings },
      { name: 'autoArchiveTrialContacts', handler: autoArchiveTrialContacts },
      { name: 'resetExpiredStreaks', handler: resetExpiredStreaks },
      { name: 'resetMonthlyScores', handler: resetMonthlyScores },
      { name: 'sendBookingReminders', handler: sendBookingReminders },
    ]

    const results: TaskResult[] = []

    for (const task of tasks) {
      console.log(`Starting task: ${task.name}`) // eslint-disable-line no-console
      try {
        const result = await task.handler()
        results.push({ name: task.name, status: 'success', result })
        console.log(`Completed task: ${task.name}`, result) // eslint-disable-line no-console
      } catch (error) {
        const err = error as Error
        console.error(`Error in task: ${task.name}`, err) // eslint-disable-line no-console
        results.push({ name: task.name, status: 'error', error: err.message || String(err) })
        // Continue with remaining tasks even if one fails
      }
    }

    console.log('Daily tasks completed:', results) // eslint-disable-line no-console
  },
)
