import type { Timestamp } from './common'

// ─── Affiliation axis — "do they belong, and to what?" ───────────────────────
//
// Generalises the old single-valued org-membership into a SET: a contact may hold
// several affiliations at once (a club membership + a federation licence + a
// grading), each its own record with an issuer, a (configurable) status, and a
// validity window. Belonging never freezes — that's the subscription axis.
//
// Status vocabulary is REUSED from the existing org membership status defs
// (OrgMembershipStatusDef in ./membership) — there is no parallel canonical enum.
// Each affiliation stores its `status_id` plus a denormalised `active` boolean
// (from the status def's countsAsActive) that drives the rollups.

// Who grants / issues the affiliation:
//  - 'team'     the studio grants it itself (an internal club membership)
//  - 'org'      scoped to a linked organisation (a federation / Verein the team belongs to)
//  - 'external' a governing body the studio only TRACKS (it issues, the studio records validity)
export const AFFILIATION_ISSUERS = ['team', 'org', 'external'] as const
export type AffiliationIssuer = (typeof AFFILIATION_ISSUERS)[number]

// A single affiliation a contact holds — contacts/{contactId}/affiliations/{id}.
export interface Affiliation {
  id: string
  teamId: string
  affiliation_type_id: string // FK to the type catalog (org-wide or team-local)
  type_key?: string // denormalized machine key (e.g. 'club' | 'federation_licence' | 'grading')
  label?: string // denormalized display label
  issuer: AffiliationIssuer
  org_id?: string // set when issuer === 'org' — references organizations/{orgId}
  issuer_name?: string // governing-body name when issuer === 'external'
  status_id: string // a configurable status def (org's membership_statuses, or the built-in defaults)
  active: boolean // denormalized from the status def's countsAsActive — drives rollups
  reference?: string // licence / registration number
  valid_from?: Timestamp
  valid_until?: Timestamp
  created_at?: Timestamp
  updated_at?: Timestamp
  created_by?: string
}

// A configurable affiliation TYPE — defined org-wide
// (organizations/{orgId}/affiliation_types) AND team-local
// (teams/{teamId}/affiliation_types), mirroring how ranking_systems work.
export interface AffiliationType {
  id: string
  key: string // stable machine key
  label: string // display
  default_issuer: AffiliationIssuer
  issuer_name?: string // governing body, for 'external' types
  org_id?: string // for 'org' types — which org this type belongs to
  default_validity_months?: number
  active?: boolean
  order?: number
}

// Denormalized onto Contact.affiliation_summary by the onAffiliationWrite trigger —
// the single shape the contacts list, Firestore rules, and "contacts in org X"
// queries read (never the affiliations subcollection directly in a list).
export interface AffiliationSummary {
  has_active: boolean
  types: string[] // distinct type_keys the contact holds
  org_ids: string[] // distinct org_ids of the contact's org-issued affiliations
}
