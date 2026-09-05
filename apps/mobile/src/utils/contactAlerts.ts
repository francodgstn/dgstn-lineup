// Thin re-export of @linyup/shared's contact-alert reader (schedule parsing +
// the fired predicate — see its module header for the two-document-shape
// story). The one thing kept local: `alert_type`, a live field
// (booking / automation / form_submission / contact_request) that the shared
// `RawContactAlert` / `readAlert` do not yet propagate but this app's
// AlertsCard reads to pick an icon.
import {
  readAlert as sharedReadAlert,
  type RawContactAlert as SharedRawContactAlert,
} from '@linyup/shared';
import type { ContactAlert } from '../types';

export { alertSchedule, alertIsFired, alertIsActive } from '@linyup/shared';
export type { AlertSchedule, AlertFiredContext } from '@linyup/shared';

/** Raw shape read off a `contacts/{id}/contact_alerts/{id}` doc — the shared
 *  shape plus `alert_type` (see the module header). */
export interface RawContactAlert extends SharedRawContactAlert {
  alert_type?: string | null;
}

/** Both document shapes in, one canonical flat `ContactAlert` out — same as
 *  @linyup/shared's `readAlert`, plus `alert_type`. */
export function readAlert(id: string, raw: RawContactAlert): ContactAlert {
  return { ...sharedReadAlert(id, raw), alert_type: raw.alert_type ?? undefined };
}
