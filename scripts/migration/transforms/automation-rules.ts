/**
 * Fixes the one condition-type mismatch in `automation_rules` that is
 * confirmed to silently break a migrated rule, and flags (never silently
 * drops) the ones this transform cannot fix.
 *
 * ── THE BUG THIS RENAMES ────────────────────────────────────────────────────
 * hmd-lineup's current app writes the "portal booking still no-show after N
 * days" condition as `{ type: 'portal_booking_no_show', delay_days }` (see
 * hmd-lineup/src/routes/TeamSettings/components/OutreachTab/OutreachTab.js —
 * CONDITION_TYPES[0] and systemDefaults.js's SYSTEM_RULES). Linyup's engine
 * (packages/functions/src/utils/automationEngine.ts) renamed the canonical
 * condition to `bio_link_booking_no_show`, and its `normalizeRule` legacy-alias
 * check exists specifically to catch old hmd-lineup rule shapes — but the
 * string it checks for is `portal_booking_pending`, an EVEN OLDER name that
 * hmd-lineup itself already migrated away from
 * (hmd-lineup/functions/src/dailyTasks/tasks/sendAutomationRuleEmails.js:25-28
 * renames `portal_booking_pending` → `portal_booking_no_show` server-side), so
 * no rule written by the current hmd-lineup app ever carries that string.
 * Net effect on an unrenamed pass-through: `hasBookingCondition` in
 * automationEngine.ts never matches, so the rule is dispatched down the
 * ordinary per-contact path instead of `runBookingRule` — and the condition
 * then falls through the evaluator's fail-closed `default` case, so the rule
 * never fires. Renaming it here means a migrated rule is correct on arrival,
 * independent of whether that stale alias is ever patched upstream (out of
 * this script's directory — see packages/functions).
 *
 * ── WHAT THIS DELIBERATELY DOES NOT FIX ─────────────────────────────────────
 * `contact_type` and `membership_status` conditions have no Linyup equivalent
 * — both were retired when Contact.type / membership_* were replaced by the
 * acquisition/affiliation/subscription axes, and there is no lossless mapping
 * from e.g. `membership_status: 'being_checked'` to an affiliation status id a
 * given team may not even have. hmd-lineup's own SYSTEM_RULES ship
 * `contact_type` alongside the no-show condition, so this is not a rare shape.
 * automationEngine.ts's evaluator already has a considered answer for exactly
 * this case — fail CLOSED and log, because "an ignored `contact_type`
 * condition once turned a 'welcome new trial' rule into 'email every new
 * contact'" (see its `default:` case). Silently dropping the condition here
 * would reproduce that exact defect one layer earlier, so it is left in
 * place: the rule keeps failing closed (safe — it sends nothing) rather than
 * firing to a guessed audience. Callers of this transform get the list back
 * so they can log it loudly instead.
 */

const BOOKING_NO_SHOW_CONDITION_ALIASES = new Set([
  'portal_booking_no_show', // current hmd-lineup condition type — the actual bug
  'portal_booking_pending', // the older name hmd-lineup itself already retired
])

const RETIRED_CONDITION_TYPES = new Set(['contact_type', 'membership_status'])

export interface AutomationRuleTransformResult {
  data: Record<string, unknown>
  /** Condition types carried through unchanged because Linyup has no equivalent. */
  unmappedConditionTypes: string[]
}

export function transformAutomationRule(src: Record<string, unknown>): AutomationRuleTransformResult {
  const unmappedConditionTypes: string[] = []
  const conditions = Array.isArray(src.conditions) ? src.conditions : []

  const nextConditions = conditions.map((c) => {
    const cond = c as { type?: unknown }
    if (typeof cond.type !== 'string') return c
    if (BOOKING_NO_SHOW_CONDITION_ALIASES.has(cond.type)) {
      return { ...(c as Record<string, unknown>), type: 'bio_link_booking_no_show' }
    }
    if (RETIRED_CONDITION_TYPES.has(cond.type)) {
      unmappedConditionTypes.push(cond.type)
    }
    return c
  })

  return {
    data: { ...src, conditions: nextConditions },
    unmappedConditionTypes,
  }
}
