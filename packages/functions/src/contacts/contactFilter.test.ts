import assert from 'node:assert/strict'
import {
  EMPTY_CONTACT_FILTER,
  calcAgeYears,
  contactMatchesGroup,
  countActiveFilters,
  filterContacts,
  groupsForContact,
  matchesFilter,
  membersOfGroup,
  wouldCreateCycle,
  type ContactFilter,
  type ContactFilterSubject,
  type ContactGroup,
} from '@linyup/shared'

// Fixtures for the ONE contact predicate — the resolver shared by the contacts
// list, saved filter presets, dynamic contact groups and the automation
// engine's in_group condition.
// Run with: pnpm --filter @linyup/functions test

const NOW = Date.UTC(2026, 7, 16) // 2026-08-16, the reference "today"

function ts(iso: string) {
  return { seconds: Math.floor(new Date(iso).getTime() / 1000), nanoseconds: 0 }
}

function contact(overrides: Partial<ContactFilterSubject> = {}): ContactFilterSubject {
  return { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@example.com', ...overrides }
}

function filter(overrides: Partial<ContactFilter> = {}): ContactFilter {
  return { ...EMPTY_CONTACT_FILTER, ...overrides }
}

function group(overrides: Partial<ContactGroup> & { id: string }): ContactGroup {
  return { name: overrides.id, parent_id: null, ...overrides }
}

describe('matchesFilter — empty filter', () => {
  it('matches everything', () => {
    assert.equal(matchesFilter(contact(), EMPTY_CONTACT_FILTER, { nowMs: NOW }), true)
    assert.equal(matchesFilter(contact(), null, { nowMs: NOW }), true)
  })

  it('counts no active dimensions', () => {
    assert.equal(countActiveFilters(EMPTY_CONTACT_FILTER), 0)
  })

  it('backfills missing keys from a partial (older saved preset)', () => {
    // A preset written before `tags`/`age` existed must not throw or over-match.
    assert.equal(matchesFilter(contact(), { stages: ['joined'] }, { nowMs: NOW }), false)
    assert.equal(
      matchesFilter(contact({ acquisition_stage: 'joined' }), { stages: ['joined'] }, { nowMs: NOW }),
      true,
    )
  })
})

describe('matchesFilter — subscriptions', () => {
  it('matches the primary subscription_type_id', () => {
    const c = contact({ subscription_type_id: 'adult-monthly' })
    assert.equal(matchesFilter(c, filter({ subscriptions: ['adult-monthly'] }), { nowMs: NOW }), true)
  })

  // The old contacts-page filter read ONLY subscription_type_id while the list
  // RENDERED from active_subscriptions, so these contacts showed a subscription
  // chip yet filtered as "none".
  it('matches a subscription held only in active_subscriptions', () => {
    const c = contact({ active_subscriptions: [{ subscription_type_id: 'kids-term' }] })
    assert.equal(matchesFilter(c, filter({ subscriptions: ['kids-term'] }), { nowMs: NOW }), true)
  })

  it("'none' means no subscription in EITHER field", () => {
    const bare = contact()
    const arrayOnly = contact({ active_subscriptions: [{ subscription_type_id: 'kids-term' }] })
    assert.equal(matchesFilter(bare, filter({ subscriptions: ['none'] }), { nowMs: NOW }), true)
    assert.equal(matchesFilter(arrayOnly, filter({ subscriptions: ['none'] }), { nowMs: NOW }), false)
  })

  it("ORs 'none' with a named type", () => {
    const f = filter({ subscriptions: ['none', 'adult-monthly'] })
    assert.equal(matchesFilter(contact(), f, { nowMs: NOW }), true)
    assert.equal(matchesFilter(contact({ subscription_type_id: 'adult-monthly' }), f, { nowMs: NOW }), true)
    assert.equal(matchesFilter(contact({ subscription_type_id: 'kids-term' }), f, { nowMs: NOW }), false)
  })
})

describe('calcAgeYears', () => {
  it('is calendar-correct, not a 365.25-day division', () => {
    // Born 2013-08-17 — the day BEFORE the birthday in 2026 ⇒ still 12.
    assert.equal(calcAgeYears(Date.UTC(2013, 7, 17), NOW), 12)
    // Born 2013-08-16 — birthday today ⇒ 13.
    assert.equal(calcAgeYears(Date.UTC(2013, 7, 16), NOW), 13)
    // Leap-day birthday, non-leap reference year.
    assert.equal(calcAgeYears(Date.UTC(2016, 1, 29), NOW), 10)
  })
})

describe('matchesFilter — age', () => {
  const twelve = contact({ birthdate: ts('2013-10-01') }) // 12 on 2026-08-16
  const thirteen = contact({ birthdate: ts('2013-01-05') }) // 13 on 2026-08-16
  const noBirthdate = contact()

  it('filters by current age', () => {
    const f = filter({ age: { mode: 'age', min: null, max: 12 } })
    assert.equal(matchesFilter(twelve, f, { nowMs: NOW }), true)
    assert.equal(matchesFilter(thirteen, f, { nowMs: NOW }), false)
  })

  // The distinction that motivated two modes: both children below are born in
  // 2013 and share a season category, but their current ages differ.
  it('filters by birth year, which age mode would split', () => {
    const f = filter({ age: { mode: 'birth_year', min: 2013, max: 2013 } })
    assert.equal(matchesFilter(twelve, f, { nowMs: NOW }), true)
    assert.equal(matchesFilter(thirteen, f, { nowMs: NOW }), true)

    const byAge = filter({ age: { mode: 'age', min: 12, max: 12 } })
    assert.equal(matchesFilter(twelve, byAge, { nowMs: NOW }), true)
    assert.equal(matchesFilter(thirteen, byAge, { nowMs: NOW }), false)
  })

  it('excludes contacts with no birthdate unless includeUnknown', () => {
    const f = filter({ age: { mode: 'age', min: 5, max: 99 } })
    assert.equal(matchesFilter(noBirthdate, f, { nowMs: NOW }), false)
    const lenient = filter({ age: { mode: 'age', min: 5, max: 99, includeUnknown: true } })
    assert.equal(matchesFilter(noBirthdate, lenient, { nowMs: NOW }), true)
  })

  it('is inert when both bounds are null', () => {
    const f = filter({ age: { mode: 'age', min: null, max: null } })
    assert.equal(matchesFilter(noBirthdate, f, { nowMs: NOW }), true)
    assert.equal(countActiveFilters(f), 0)
  })

  // The reason a snapshot group cannot express an age band: nothing is written
  // when a contact ages out, so only a live predicate stays correct.
  it('changes answer as the clock moves, with no change to the contact', () => {
    const f = filter({ age: { mode: 'age', min: null, max: 12 } })
    const beforeBirthday = Date.UTC(2026, 8, 30) // 2026-09-30
    const afterBirthday = Date.UTC(2026, 9, 2) // 2026-10-02
    assert.equal(matchesFilter(twelve, f, { nowMs: beforeBirthday }), true)
    assert.equal(matchesFilter(twelve, f, { nowMs: afterBirthday }), false)
  })
})

describe('matchesFilter — tags and custom fields', () => {
  it('ORs tags within the dimension', () => {
    const c = contact({ tags: ['competition', 'volunteer'] })
    assert.equal(matchesFilter(c, filter({ tags: ['competition'] }), { nowMs: NOW }), true)
    assert.equal(matchesFilter(c, filter({ tags: ['staff'] }), { nowMs: NOW }), false)
    assert.equal(matchesFilter(c, filter({ tags: ['staff', 'volunteer'] }), { nowMs: NOW }), true)
  })

  it('ANDs custom-field conditions', () => {
    const c = contact({ custom_fields: { licence: 'A123', weight: 62, waiver: true } })
    const ok = filter({
      customFields: [
        { fieldId: 'licence', op: 'is_set' },
        { fieldId: 'weight', op: 'gt', value: 60 },
      ],
    })
    assert.equal(matchesFilter(c, ok, { nowMs: NOW }), true)

    const bad = filter({
      customFields: [
        { fieldId: 'licence', op: 'is_set' },
        { fieldId: 'weight', op: 'lt', value: 60 },
      ],
    })
    assert.equal(matchesFilter(c, bad, { nowMs: NOW }), false)
  })

  it('compares ISO dates lexically', () => {
    const c = contact({ custom_fields: { medical_check: '2026-03-01' } })
    const f = filter({ customFields: [{ fieldId: 'medical_check', op: 'lt', value: '2026-06-01' }] })
    assert.equal(matchesFilter(c, f, { nowMs: NOW }), true)
  })

  it('handles booleans and empties', () => {
    const c = contact({ custom_fields: { waiver: false } })
    assert.equal(
      matchesFilter(c, filter({ customFields: [{ fieldId: 'waiver', op: 'equals', value: false }] }), { nowMs: NOW }),
      true,
    )
    assert.equal(
      matchesFilter(c, filter({ customFields: [{ fieldId: 'missing', op: 'is_empty' }] }), { nowMs: NOW }),
      true,
    )
    assert.equal(
      matchesFilter(c, filter({ customFields: [{ fieldId: 'missing', op: 'is_set' }] }), { nowMs: NOW }),
      false,
    )
  })
})

describe('matchesFilter — search', () => {
  it('matches name or email, case-insensitively', () => {
    const c = contact()
    assert.equal(matchesFilter(c, filter({ search: 'love' }), { nowMs: NOW }), true)
    assert.equal(matchesFilter(c, filter({ search: 'ADA@' }), { nowMs: NOW }), true)
    assert.equal(matchesFilter(c, filter({ search: 'babbage' }), { nowMs: NOW }), false)
  })

  it('counts as an active dimension, so presets capture it', () => {
    assert.equal(countActiveFilters(filter({ search: 'love' })), 1)
    assert.equal(countActiveFilters(filter({ search: '   ' })), 0)
  })
})

describe('dynamic groups', () => {
  const manual = group({ id: 'squad-a' })
  const juniors = group({
    id: 'juniors',
    rule: filter({ age: { mode: 'age', min: null, max: 12 } }),
  })

  it('resolves manual membership from group_ids', () => {
    assert.equal(contactMatchesGroup(contact({ group_ids: ['squad-a'] }), manual), true)
    assert.equal(contactMatchesGroup(contact(), manual), false)
  })

  it('derives dynamic membership from the rule, ignoring group_ids', () => {
    const kid = contact({ birthdate: ts('2016-05-02') })
    const adult = contact({ birthdate: ts('1990-05-02'), group_ids: ['juniors'] })
    assert.equal(contactMatchesGroup(kid, juniors, { nowMs: NOW }), true)
    // Stored membership is irrelevant for a dynamic group — the rule is the truth.
    assert.equal(contactMatchesGroup(adult, juniors, { nowMs: NOW }), false)
  })

  it('lists a contact\'s groups without needing a contact list', () => {
    const kid = contact({ birthdate: ts('2016-05-02'), group_ids: ['squad-a'] })
    const names = groupsForContact(kid, [manual, juniors], { nowMs: NOW }).map((g) => g.id)
    assert.deepEqual(names.sort(), ['juniors', 'squad-a'])
  })

  it('lists members out of an already-loaded list', () => {
    const contacts = [
      contact({ firstname: 'Kid', birthdate: ts('2016-05-02') }),
      contact({ firstname: 'Adult', birthdate: ts('1990-05-02') }),
    ]
    const members = membersOfGroup(contacts, juniors, { nowMs: NOW })
    assert.deepEqual(members.map((c) => c.firstname), ['Kid'])
  })

  it('cannot recurse: the groups dimension is stripped inside a rule', () => {
    const a: ContactGroup = group({ id: 'a', rule: filter({ groups: ['b'] }) })
    const b: ContactGroup = group({ id: 'b', rule: filter({ groups: ['a'] }) })
    // Would stack-overflow if the groups dimension survived into rule evaluation.
    assert.equal(contactMatchesGroup(contact(), a, { groups: [a, b], nowMs: NOW }), true)
    assert.equal(matchesFilter(contact(), filter({ groups: ['a'] }), { groups: [a, b], nowMs: NOW }), true)
  })

  it('expands a selected parent to its descendants', () => {
    const parent = group({ id: 'seniors' })
    const child = group({ id: 'seniors-comp', parent_id: 'seniors' })
    const ctx = { groups: [parent, child], nowMs: NOW }
    const f = filter({ groups: ['seniors'] })
    assert.equal(matchesFilter(contact({ group_ids: ['seniors-comp'] }), f, ctx), true)
    assert.equal(matchesFilter(contact({ group_ids: ['other'] }), f, ctx), false)
  })

  it('expands into a DYNAMIC descendant, resolving its rule', () => {
    const parent = group({ id: 'youth' })
    const dyn = group({
      id: 'youth-u12',
      parent_id: 'youth',
      rule: filter({ age: { mode: 'age', min: null, max: 12 } }),
    })
    const ctx = { groups: [parent, dyn], nowMs: NOW }
    const kid = contact({ birthdate: ts('2016-05-02') })
    assert.equal(matchesFilter(kid, filter({ groups: ['youth'] }), ctx), true)
  })

  it('falls back to stored membership when the group is not in context', () => {
    // A partial context must never silently widen the result set.
    const f = filter({ groups: ['unknown-group'] })
    assert.equal(matchesFilter(contact({ group_ids: ['unknown-group'] }), f, { nowMs: NOW }), true)
    assert.equal(matchesFilter(contact(), f, { nowMs: NOW }), false)
  })
})

describe('wouldCreateCycle', () => {
  const a = group({ id: 'a' })
  const b = group({ id: 'b', parent_id: 'a' })
  const c = group({ id: 'c', parent_id: 'b' })
  const groups = [a, b, c]

  it('allows a normal re-parent', () => {
    assert.equal(wouldCreateCycle(groups, 'c', 'a'), false)
    assert.equal(wouldCreateCycle(groups, 'c', null), false)
  })

  it('rejects self-parenting and descendant-parenting', () => {
    assert.equal(wouldCreateCycle(groups, 'a', 'a'), true)
    assert.equal(wouldCreateCycle(groups, 'a', 'c'), true)
    assert.equal(wouldCreateCycle(groups, 'b', 'c'), true)
  })
})

describe('filterContacts', () => {
  it('ANDs across dimensions', () => {
    const contacts = [
      contact({ firstname: 'A', acquisition_stage: 'joined', tags: ['comp'] }),
      contact({ firstname: 'B', acquisition_stage: 'joined', tags: [] }),
      contact({ firstname: 'C', acquisition_stage: 'trial_booked', tags: ['comp'] }),
    ]
    const out = filterContacts(contacts, filter({ stages: ['joined'], tags: ['comp'] }), { nowMs: NOW })
    assert.deepEqual(out.map((c) => c.firstname), ['A'])
  })
})
