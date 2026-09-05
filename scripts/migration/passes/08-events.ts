import type { MigrationConfig } from '../config'
import { sourceDb, targetDb, mapSourceEventType } from '../config'
import { BatchWriter } from '../batch-writer'
import { transformEvent } from '../transforms/events'

export async function pass08Events(cfg: MigrationConfig, teamIds?: string[]): Promise<void> {
  console.log('Pass 8: events + invitations + attendees + global checkins')
  const src = sourceDb()
  const tgt = targetDb()
  const bw  = new BatchWriter(tgt, cfg.dryRun)

  const snap = await src.collection('events').get()
  for (const d of snap.docs) {
    const eventId = d.id
    const tgtRef  = tgt.collection('events').doc(eventId)

    if (!cfg.dryRun) {
      const existing = await tgtRef.get()
      if (existing.exists && !cfg.overwrite) {
        bw.skip()
        // Even if the event doc already exists, we still migrate any checkins
        // that haven't been written yet (they are handled below with their own
        // skip-if-exists guard), and we update the counts at the end.
      } else {
        bw.set(tgtRef, transformEvent(d.data() as Record<string, unknown>))
      }
    } else {
      // dry-run: count write
      bw.set(tgtRef, transformEvent(d.data() as Record<string, unknown>))
    }

    // Migrate event subcollections (invitations, attendees)
    for (const sub of ['invitations', 'attendees'] as const) {
      const subSnap = await src.collection('events').doc(eventId).collection(sub).get()
      for (const sd of subSnap.docs) {
        const subRef = tgt.collection('events').doc(eventId).collection(sub).doc(sd.id)
        if (!cfg.dryRun) {
          const existing = await subRef.get()
          if (existing.exists && !cfg.overwrite) { bw.skip(); continue }
        }
        bw.set(subRef, sd.data())
      }
    }

    // ── Migrate event check-ins from the global `checkins` collection ───────
    //
    // In hmd-lineup, check-ins for events live in the TOP-LEVEL `checkins`
    // collection (not a subcollection of events). Each doc has the shape:
    //   { event: { id, title?, type? }, contact: { id, firstname, lastname },
    //     is_completed, teamId, ... }
    // They are queried by the event UI as: where('event.id', '==', eventId).
    //
    // The Linyup target model is identical — the event check-in UI reads the
    // same global `checkins` collection with the same query. So we copy these
    // docs verbatim, preserving doc IDs.
    //
    // SESSION checkins (those without an event.id) are intentionally NOT
    // migrated here — they belong to a different UI surface and are skipped
    // per MIGRATE-HMD.md.

    const checkinSnap = await src
      .collection('checkins')
      .where('event.id', '==', eventId)
      .get()

    let completedCount = 0

    for (const cd of checkinSnap.docs) {
      const tgtCheckinRef = tgt.collection('checkins').doc(cd.id)
      if (!cfg.dryRun) {
        const existing = await tgtCheckinRef.get()
        if (existing.exists && !cfg.overwrite) {
          // Still count for the aggregate — checkin was already migrated
          if (existing.data()?.is_completed === true) completedCount++
          bw.skip()
          continue
        }
      }

      const checkinData = cd.data() as Record<string, unknown>

      // ── THE SAMPLE REACHES CHECK-INS TOO ─────────────────────────────────
      // Events are org-wide and all of them come over; a CHECK-IN belongs to a
      // club. Copying every one under `--teams` would leave the target holding
      // attendance for contacts the sample never imported — rows that point at
      // nothing, which is worse than absent because the belt engine counts them
      // as participation while no contact page can show them.
      //
      // `teamIds` is undefined on a full run, and then this does nothing.
      if (teamIds && !teamIds.includes(String(checkinData.teamId ?? ''))) {
        bw.skip()
        continue
      }

      // Basic field guard: ensure required fields are present before writing.
      // If teamId is missing, leave it absent rather than inventing a value.
      const eventObj    = checkinData.event    as Record<string, unknown> | undefined
      const contactObj  = checkinData.contact  as Record<string, unknown> | undefined

      if (!eventObj?.id || !contactObj?.id) {
        console.warn(`  checkin ${cd.id} for event ${eventId} missing event.id or contact.id — skipped`)
        bw.skip()
        continue
      }

      // The check-in carries a DENORMALISED copy of the event's type, and
      // `transformEvent` has just remapped the event's own. Left alone the two
      // disagree, and the copy is the one that will be read: the rank
      // progression engine builds its participation facts from COMPLETED
      // CHECK-INS and matches `EventParticipationSpec.eventTypes` against the
      // type recorded on them. HMD's rule names `hmd_fighting_cup`, so a
      // check-in still stamped `fighting_cup` is a cup that never counts toward
      // the one-camp-one-tournament-one-exam requirement — the belt engine
      // silently short by one, for every competitor, for every migrated year.
      eventObj.type = mapSourceEventType(eventObj.type)

      if (checkinData.is_completed === true) completedCount++
      bw.set(tgtCheckinRef, checkinData)
    }

    if (checkinSnap.size > 0) {
      console.log(`  event ${eventId}: ${checkinSnap.size} checkin(s), ${completedCount} completed`)
    }

    // ── Update event doc with completed_checkins_count ───────────────────────
    // Merge the count into the event doc after we know the total. This is safe
    // even if the event doc was just set above (BatchWriter accumulates ops in
    // the same batch; the count merge runs after all checkin ops are enqueued).
    // attendees_count is already set by transformEvent.
    if (!cfg.dryRun) {
      // Use merge so we don't overwrite the rest of the event doc
      bw.merge(tgtRef, { completed_checkins_count: completedCount })
    }
    // dry-run: skip the merge — counts are printed above
  }
  await bw.done()
}
