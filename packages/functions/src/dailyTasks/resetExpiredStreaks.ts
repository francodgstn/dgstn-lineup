import * as admin from 'firebase-admin'
import { format, subWeeks, startOfISOWeek } from 'date-fns'
import { to } from '../utils/async'
import { resolveGamificationSettings } from '../utils/scoring'
import { computeContactStreak } from '../utils/scoreComputation'
import { CONTACTS_COLLECTION, TEAMS_COLLECTION } from '@linyup/shared'

const ISO_WEEK_FORMAT = `R-'W'II`

export async function resetExpiredStreaks(): Promise<{ checked: number; reset: number }> {
  const db = admin.firestore()
  const now = new Date()

  // The most recent fully-completed ISO week (week that ended last Sunday)
  const previousIsoWeek = format(subWeeks(startOfISOWeek(now), 1), ISO_WEEK_FORMAT)

  console.log(`resetExpiredStreaks: previous completed week = ${previousIsoWeek}`) // eslint-disable-line no-console

  const [contactsErr, contactsSnap] = await to(
    db.collection(CONTACTS_COLLECTION).where('current_streak', '>', 0).get(),
  )

  if (contactsErr) {
    console.error('resetExpiredStreaks: error fetching contacts', contactsErr) // eslint-disable-line no-console
    throw contactsErr
  }

  if (!contactsSnap || contactsSnap.empty) {
    console.log('resetExpiredStreaks: no contacts with active streaks') // eslint-disable-line no-console
    return { checked: 0, reset: 0 }
  }

  // Only process contacts whose last qualified week is before the previous week
  const atRisk = contactsSnap.docs.filter((doc) => {
    const lqw = doc.data().streak_last_qualified_week as string | undefined
    return !lqw || lqw < previousIsoWeek
  })

  console.log(`resetExpiredStreaks: ${contactsSnap.size} with streak > 0, ${atRisk.length} potentially expired`) // eslint-disable-line no-console

  if (atRisk.length === 0) return { checked: 0, reset: 0 }

  // Cache team settings to avoid re-fetching for contacts on the same team
  const teamSettingsCache: Record<string, ReturnType<typeof resolveGamificationSettings> | null> = {}
  let reset = 0

  for (const contactDoc of atRisk) {
    const contact = contactDoc.data()
    const teamId = (contact.teamId || contact.teacher) as string | undefined
    if (!teamId) continue

    if (!(teamId in teamSettingsCache)) {
      const [teamErr, teamDoc] = await to(db.collection(TEAMS_COLLECTION).doc(teamId).get())
      if (teamErr || !teamDoc || !teamDoc.exists) {
        teamSettingsCache[teamId] = null
        continue
      }
      const settings = resolveGamificationSettings(teamDoc.data()?.settings?.gamification)
      teamSettingsCache[teamId] = settings.enabled ? settings : null
    }

    const settings = teamSettingsCache[teamId]
    if (!settings) continue

    const result = await computeContactStreak(db, contactDoc.id, teamId, settings)

    if (result.current_streak !== (contact.current_streak as number)) {
      const [updateErr] = await to(
        contactDoc.ref.update({
          current_streak: result.current_streak,
          streak_last_qualified_week: result.streak_last_qualified_week,
          max_streak: Math.max(result.max_streak, (contact.max_streak as number) || 0),
        }),
      )
      if (!updateErr) {
        console.log(`resetExpiredStreaks: contact=${contactDoc.id} streak ${contact.current_streak} → ${result.current_streak}`) // eslint-disable-line no-console
        reset++
      }
    }
  }

  return { checked: atRisk.length, reset }
}
