import { ORG_ID } from '../config'

export function transformEvent(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  // All HMD events become org-wide
  out.scope  = 'org'
  out.orgId  = ORG_ID
  out.teamId = null

  // New required fields with defaults
  out.status                 = out.status                 ?? 'closed'
  out.participants_count     = out.participants_count     ?? 0
  out.attendees_count        = out.attendees_count        ?? 0
  out.invitations_sent_count = out.invitations_sent_count ?? 0
  out.deleted_at             = out.deleted_at             ?? null
  out.createdBy              = out.createdBy              ?? null
  out.type                   = out.type                   ?? 'competition'

  // fee may be stored as `price` in old system
  if ('price' in out && !('fee' in out)) { out.fee = out.price; delete out.price }

  return out
}
