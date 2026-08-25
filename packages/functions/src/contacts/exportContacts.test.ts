import assert from 'node:assert/strict'
import { toContactsCsv, CONTACT_CSV_COLUMNS } from '@linyup/shared'

/** A Firestore-shaped Timestamp, which is what the real rows carry. */
const ts = (iso: string) => ({ toDate: () => new Date(iso) })

function rows(csv: string): string[] {
  return csv.trimEnd().split('\r\n')
}

describe('toContactsCsv', () => {
  it('always emits a header, even with no contacts', () => {
    const out = rows(toContactsCsv([]))
    assert.equal(out.length, 1)
    assert.equal(out[0], CONTACT_CSV_COLUMNS.join(','))
  })

  // The failure this guards is silent and destroys the file: a comma in a name
  // shifts every later column by one, and nothing errors.
  it('quotes fields containing a comma, a quote or a newline', () => {
    const csv = toContactsCsv([
      { id: 'c1', lastname: 'Müller, Anna', notes: 'said "yes"\nthen left' },
    ])
    const line = rows(csv)[1]
    assert.match(line, /"Müller, Anna"/)
    assert.match(line, /"said ""yes""\nthen left"/)
  })

  it('renders timestamps as ISO, and a birthdate as a date only', () => {
    const csv = toContactsCsv([
      { id: 'c1', birthdate: ts('1990-04-05T00:00:00Z'), created_at: ts('2026-01-02T03:04:05Z') },
    ])
    const line = rows(csv)[1]
    assert.match(line, /1990-04-05(,|$)/)
    assert.ok(line.includes('2026-01-02T03:04:05.000Z'))
    assert.ok(!line.includes('1990-04-05T'), 'birthdate must carry no time')
  })

  it('flattens the address map and the emergency-contact list', () => {
    const csv = toContactsCsv([
      {
        id: 'c1',
        address: { route: 'Kleinhüningerstrasse', street_number: '205', postal_code: '4057', locality: 'Basel' },
        emergency_contacts: [{ name: 'Ana', phone: '+41 79 000 00 00' }],
      },
    ])
    const line = rows(csv)[1]
    assert.ok(line.includes('Kleinhüningerstrasse 205, 4057 Basel'))
    assert.ok(line.includes('Ana +41 79 000 00 00'))
  })

  // An id means nothing once the file leaves us — the point of an export is that
  // it survives leaving.
  it('resolves group ids to names, and falls back to the id when unknown', () => {
    const csv = toContactsCsv([{ id: 'c1', group_ids: ['g1', 'g-missing'] }], {
      groupNames: new Map([['g1', 'Adults']]),
    })
    assert.ok(rows(csv)[1].includes('Adults; g-missing'))
  })

  it('appends one column per custom field, in the studio order', () => {
    const csv = toContactsCsv([{ id: 'c1', custom_fields: { belt: 'blue', risk: true } }], {
      customFields: [
        { id: 'belt', label: 'Belt' },
        { id: 'risk', label: 'Payment risk' },
      ],
    })
    const [header, line] = rows(csv)
    assert.ok(header.endsWith('Belt,Payment risk'))
    assert.ok(line.endsWith('blue,yes'), 'booleans read as yes/no, not true/false')
  })

  // Two fields may share a label. Without the id suffix the two columns look
  // identical and a reader cannot tell which is which.
  it('disambiguates duplicate custom-field labels with the field id', () => {
    const csv = toContactsCsv([{ id: 'c1', custom_fields: { a: '1', b: '2' } }], {
      customFields: [
        { id: 'a', label: 'Notes' },
        { id: 'b', label: 'Notes' },
      ],
    })
    assert.ok(rows(csv)[0].endsWith('Notes (a),Notes (b)'))
  })

  it('leaves a missing custom-field value empty rather than writing undefined', () => {
    const csv = toContactsCsv([{ id: 'c1' }], { customFields: [{ id: 'belt', label: 'Belt' }] })
    const line = rows(csv)[1]
    assert.ok(line.endsWith(','), 'trailing empty cell')
    assert.ok(!line.includes('undefined'))
  })

  it('emits one row per contact, in the order given', () => {
    const csv = toContactsCsv([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const out = rows(csv)
    assert.equal(out.length, 4)
    assert.ok(out[1].startsWith('a,'))
    assert.ok(out[3].startsWith('c,'))
  })
})
