import { ORG_ID, mapSourceEventType } from '../config'

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
  // NOT `?? 'competition'`: the source's own "no type" value is `''`, which a
  // nullish coalesce passes straight through, and `'fighting_cup'` has to reach
  // the plugin's own slug or the cup loses its whole UI. See mapSourceEventType.
  out.type                   = mapSourceEventType(out.type)

  // fee may be stored as `price` in old system
  if ('price' in out && !('fee' in out)) { out.fee = out.price; delete out.price }

  return out
}
