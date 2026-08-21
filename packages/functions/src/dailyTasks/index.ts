import { onSchedule } from 'firebase-functions/v2/scheduler'
import { markNoShowBookings } from './markNoShowBookings'
import { resetExpiredStreaks } from './resetExpiredStreaks'
import { resetMonthlyScores } from './resetMonthlyScores'
import { sendBookingReminders } from './sendBookingReminders'
import { runScheduledRules } from './runScheduledRules'
import { expireAffiliations } from './expireAffiliations'
import { expirePendingBookings } from './expirePendingBookings'
import { expireOrgMemberInvitations } from './expireOrgMemberInvitations'
import { purgeProvisionalContacts } from './purgeProvisionalContacts'
import { materializeRecurringEntries } from './materializeRecurringEntries'
import { refreshCustomDomains } from './refreshCustomDomains'
import { assertZoneRecordsUnproxied } from './assertZoneRecordsUnproxied'
import { rollSessionSeries } from './rollSessionSeries'
import { sweepWaitlistOffers } from '../booking/waitlist/sweep'
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
    // The waitlist rides this schedule for the same reason reminders do: a claim
    // window is two hours, so an offer that lapses at 11:00 has to roll on to the
    // next person then — the 02:00 batch would leave the seat dead all day. Its
    // own failure must not take the reminders down with it, and the next hour
    // re-derives everything from storage.
    try {
      await sweepWaitlistOffers()
    } catch (err) {
      console.error('sweepWaitlistOffers failed:', err) // eslint-disable-line no-console
    }
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
      // Org member invitations past their deadline. Bookkeeping ONLY — accepting
      // already refuses on the deadline itself, so this sweep can never grant
      // anything and its failure is a stale row, not an open door. See the
      // module header for why it earns a place the waiver work gave nothing.
      { name: 'expireOrgMemberInvitations', handler: expireOrgMemberInvitations },
      { name: 'purgeProvisionalContacts', handler: purgeProvisionalContacts },
      // The rolling 6-month horizon for recurring classes. Without it a series
      // simply stops at whatever was materialised the day it was created, and
      // every public booking link for it goes with it.
      { name: 'rollSessionSeries', handler: rollSessionSeries },
      // Recurring accounting entry templates (finance plugin) — e.g. monthly rent.
      { name: 'materializeRecurringEntries', handler: materializeRecurringEntries },
      // Custom domains: re-poll Cloudflare. Catches a domain that stops working
      // with no event on our side — a lapsed certificate, or a CNAME the studio
      // removed at their registrar. Status only; never registers or deletes.
      { name: 'refreshCustomDomains', handler: refreshCustomDomains },
      // Alarm for a linyup.com record that has been proxied when it should be
      // DNS-only. Since the tenant-router now passes such hosts through instead
      // of refusing them, the misconfiguration is no longer visible — but it
      // still flattens CNAMEs, which is what silently broke DKIM and cert
      // renewal on 2026-08-21.
      { name: 'assertZoneRecordsUnproxied', handler: assertZoneRecordsUnproxied },
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
