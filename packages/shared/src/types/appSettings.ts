import type { Timestamp } from './common'

// `app_settings/mobile` — the member app's platform policy, WORLD-READABLE
// (firestore.rules: `allow read: if true`) because the app must read it before
// anyone has signed in. Operator-written only (the console, Admin SDK).
//
// Nothing here is sensitive: a minimum version and two store links. The one
// doc in `app_settings` that carries a credential — `review_access` — is a
// different document and stays default-deny; never fold it into this one.
export interface MobileAppSettings {
  /** Builds older than this show the update-required screen instead of the
   *  app. `null` / absent / malformed = no gate (`isVersionBelow` fails open). */
  min_supported_version: string | null
  /** Optional copy shown on that screen under the fixed title. */
  update_message?: string | null
  store_url_ios?: string | null
  store_url_android?: string | null
  updated_at?: Timestamp
  /** Operator email that last changed it. */
  updated_by?: string
}
