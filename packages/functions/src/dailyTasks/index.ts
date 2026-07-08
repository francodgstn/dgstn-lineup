import { onSchedule } from 'firebase-functions/v2/scheduler'
import { markNoShowBookings } from './markNoShowBookings'
import { resetExpiredStreaks } from './resetExpiredStreaks'
import { resetMonthlyScores } from './resetMonthlyScores'
import { sendBookingReminders } from './sendBookingReminders'
import { runScheduledRules } from './runScheduledRules'
import { expireAffiliations } from './expireAffiliations'
import { expirePendingBookings } from './expirePendingBookings'
import { purgeProvisionalContacts } from './purgeProvisionalContacts'
import { publishMessagingEnv } from '../mail/messagingEnvStatus'

// Booking reminders run HOURLY (not in the 02:00 batch): multi-step schedules
// (e.g. SMS 24h before) need offset accuracy, and SMS quiet-hour deferrals need
// frequent retries. Idempotent via per-step reminders_sent markers.
// Piggybacked: the messaging ENV snapshot for the operator console (a new
// deploy's param values are visible within the hour).
export const bookingRemindersHourly = onSchedule(
  { schedule: 'every 1 hours', timeZone: 'UTC', timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    await publishMessagingEnv()
    await sendBookingReminders()
  },
)


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
      // autoArchiveTrialContacts was retired — stale trial bookings are archived by
      // the default 'lib_trial_cleanup' automation rule instead (see onTeamCreated).
      { name: 'resetExpiredStreaks', handler: resetExpiredStreaks },
      { name: 'resetMonthlyScores', handler: resetMonthlyScores },
      // sendBookingReminders moved to the hourly bookingRemindersHourly schedule.
      { name: 'runScheduledRules', handler: runScheduledRules },
      { name: 'expireAffiliations', handler: expireAffiliations },
      { name: 'expirePendingBookings', handler: expirePendingBookings },
      { name: 'purgeProvisionalContacts', handler: purgeProvisionalContacts },
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
