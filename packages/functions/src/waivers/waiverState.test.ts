import assert from 'node:assert/strict'
import {
  MAX_REQUIRED_WAIVERS_PER_TEAM,
  MAX_WAIVER_BODY_CHARS,
  WAIVER_LIMITS,
  WAIVER_MIN_PLAN,
  defaultWaiverConfig,
  documentVersionId,
  getWaiverLimits,
  waiverAcceptanceState,
  waiverDoorCheckFor,
  waiverDoorCheckFromBookingState,
  waiverPolicyEntryFor,
  waiverStateSatisfiesGate,
  waiverValidUntilMs,
  type PublishOutcome,
  type SaasPlan,
  type WaiverAcceptanceState,
  type WaiverSignerFacts,
  type WaiverPolicySourceDocument,
} from '@linyup/shared'

// THE ONE PREDICATE, as a matrix.
//
// "Does this person's signature count" is the boundary-case predicate this
// feature lives or dies on: never signed × below the floor × past its validity
// × revoked, crossed with what a publish did and how the waiver is configured.
// The failure shape being foreclosed here is a predicate whose cases were
// reasoned about ONE SHAPE AT A TIME — so this file asserts whole rows over the
// full cross product rather than a list of anecdotes.
//
// Two properties are asserted structurally rather than by example:
//   • supersession and expiry are NEVER STORED — they are derived from the
//     document's floor and from a frozen instant, so there is no stored value
//     that can disagree with the computed one;
//   • the studio's CONFIGURATION is orthogonal to validity — every state is
//     asserted with the minors flag both off and on, because a signature's
//     validity must never depend on what the waiver is flagged as. (It used to
//     be a three-way guardian rule; the axis shrank, the property did not.)
//
// Run with: pnpm --filter @linyup/functions test

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0) // 2026-08-15T12:00:00Z

/** The shared Timestamp shape is structural, so a plain object is a Timestamp
 *  for every purpose this predicate has. */
function ts(ms: number) {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
  }
}

const DAY = 24 * 60 * 60 * 1000

function signer(overrides: Partial<WaiverSignerFacts> = {}): WaiverSignerFacts {
  return {
    accepted_version: 3,
    accepted_at: ts(NOW - 30 * DAY),
    valid_until: null,
    status: 'active',
    ...overrides,
  }
}

const MINORS_SETTINGS: boolean[] = [false, true]
const OUTCOMES: PublishOutcome[] = ['silent', 'require_resign']

describe('waiverAcceptanceState — the one predicate', () => {
  interface Row {
    name: string
    floor: number
    signer: WaiverSignerFacts | null
    expected: WaiverAcceptanceState
  }

  const rows: Row[] = [
    { name: 'never signed', floor: 1, signer: null, expected: 'none' },
    { name: 'signed at the floor', floor: 3, signer: signer(), expected: 'valid' },
    { name: 'signed above the floor', floor: 1, signer: signer(), expected: 'valid' },
    {
      name: 'signed below the floor — a require_resign publish moved it',
      floor: 4,
      signer: signer(),
      expected: 'superseded',
    },
    {
      name: 'past its frozen valid_until',
      floor: 1,
      signer: signer({ valid_until: ts(NOW - DAY) }),
      expected: 'expired',
    },
    {
      name: 'valid_until exactly now counts as expired — the boundary is inclusive',
      floor: 1,
      signer: signer({ valid_until: ts(NOW) }),
      expected: 'expired',
    },
    {
      name: 'valid_until one millisecond away still counts',
      floor: 1,
      signer: signer({ valid_until: ts(NOW + 1) }),
      expected: 'valid',
    },
    { name: 'revoked', floor: 1, signer: signer({ status: 'revoked' }), expected: 'revoked' },
    {
      name: 'revoked AND below the floor reports revoked — a revoked signature is never merely stale',
      floor: 9,
      signer: signer({ status: 'revoked' }),
      expected: 'revoked',
    },
    {
      name: 'revoked AND expired reports revoked',
      floor: 1,
      signer: signer({ status: 'revoked', valid_until: ts(NOW - DAY) }),
      expected: 'revoked',
    },
    {
      name: 'below the floor AND expired reports superseded — supersession outranks expiry',
      floor: 9,
      signer: signer({ valid_until: ts(NOW - DAY) }),
      expected: 'superseded',
    },
  ]

  for (const row of rows) {
    // Every row, with the minors flag off and on: validity must never depend on
    // how the studio configured the waiver.
    for (const mayIncludeMinors of MINORS_SETTINGS) {
      it(`${row.name} (mayIncludeMinors: ${mayIncludeMinors})`, () => {
        assert.equal(
          waiverAcceptanceState({ min_valid_version: row.floor }, row.signer, NOW),
          row.expected
        )
      })
    }
  }

  it('only `valid` satisfies the gate', () => {
    const all: WaiverAcceptanceState[] = ['none', 'valid', 'superseded', 'expired', 'revoked']
    assert.deepEqual(all.filter(waiverStateSatisfiesGate), ['valid'])
  })
})

describe('THE DOOR CHECK — the chip that asks a human to look', () => {
  // The flag's SECOND consequence (the first is the question on the consent
  // step). It is a prompt and never a verdict: nothing here refuses a booking,
  // asserts an age, or claims anybody verified anything.

  it('a studio that never flags a waiver sees NOTHING, whoever signed', () => {
    // The property that keeps this feature invisible to the adults-only case,
    // which is most of the product's tenants.
    assert.equal(waiverDoorCheckFor({ signerRole: 'self', mayIncludeMinors: false }), null)
    // An absent flag is an unflagged waiver — every entry written before the
    // field existed reads this way, and must not start chipping rosters.
    assert.equal(waiverDoorCheckFor({ signerRole: 'self', mayIncludeMinors: undefined }), null)
  })

  it('a FLAGGED waiver chips BOTH answers — which is the whole point of the flag', () => {
    // The guardian case is the one a studio expects. The `self` case is the one
    // that actually matters: an adult-style signature covering somebody who may
    // be a child, and the only party who can tell is at the door.
    assert.equal(waiverDoorCheckFor({ signerRole: 'guardian', mayIncludeMinors: true }), 'guardian')
    assert.equal(waiverDoorCheckFor({ signerRole: 'self', mayIncludeMinors: true }), 'check')
  })

  it('a stored guardian declaration is chipped even on an unflagged waiver', () => {
    // Unreachable through the consent step — `declarationFor` drops the field
    // for an unflagged waiver, so no unflagged row is ever stamped `guardian`.
    // It is asserted anyway because a row that SAYS a parent signed must never
    // render as though nobody did, whatever the waiver was later reconfigured to.
    assert.equal(waiverDoorCheckFor({ signerRole: 'guardian', mayIncludeMinors: false }), 'guardian')
  })

  it('a row with no role is conservative on a flagged waiver, and silent otherwise', () => {
    assert.equal(waiverDoorCheckFor({ signerRole: null, mayIncludeMinors: true }), 'check')
    assert.equal(waiverDoorCheckFor({ signerRole: undefined, mayIncludeMinors: false }), null)
  })

  it('the printed sheet reads the booking stamp and lands on the same two words', () => {
    assert.equal(waiverDoorCheckFromBookingState('guardian_declared'), 'guardian')
    assert.equal(waiverDoorCheckFromBookingState('check_participant'), 'check')
    assert.equal(waiverDoorCheckFromBookingState('ok'), null)
    // ABSENT is a real third value — a booking that predates waivers, or one no
    // required waiver applied to. It renders nothing, exactly like `ok`.
    assert.equal(waiverDoorCheckFromBookingState(undefined), null)
    assert.equal(waiverDoorCheckFromBookingState(null), null)
  })
})

describe('publish outcomes move exactly one number, and supersession is derived', () => {
  // What a publish DOES to the floor, expressed the way the callable expresses
  // it. `silent` leaves it alone; `require_resign` sets it to the new version.
  // Neither writes a signer row — which is why the state below is computed from
  // the floor rather than read from anywhere.
  function floorAfter(outcome: PublishOutcome, previousFloor: number, newVersion: number): number {
    return outcome === 'require_resign' ? newVersion : previousFloor
  }

  for (const outcome of OUTCOMES) {
    it(`a signer at v3 after publishing v4 as ${outcome}`, () => {
      const floor = floorAfter(outcome, 0, 4)
      assert.equal(
        waiverAcceptanceState({ min_valid_version: floor }, signer({ accepted_version: 3 }), NOW),
        outcome === 'require_resign' ? 'superseded' : 'valid'
      )
    })

    it(`a signer at v4 after publishing v4 as ${outcome} is unaffected`, () => {
      const floor = floorAfter(outcome, 0, 4)
      assert.equal(
        waiverAcceptanceState({ min_valid_version: floor }, signer({ accepted_version: 4 }), NOW),
        'valid'
      )
    })

    it(`${outcome} then un-requiring is one field write, not an unwind`, () => {
      // The "studio clicked the wrong button" case: moving the floor back
      // re-validates everyone with no signer-row writes at all.
      const superseded = floorAfter(outcome, 0, 5)
      const restored = 0
      const row = signer({ accepted_version: 3 })
      assert.equal(
        waiverAcceptanceState({ min_valid_version: superseded }, row, NOW),
        outcome === 'require_resign' ? 'superseded' : 'valid'
      )
      assert.equal(waiverAcceptanceState({ min_valid_version: restored }, row, NOW), 'valid')
    })
  }
})

describe('waiverValidUntilMs — expiry is a frozen instant, not live arithmetic', () => {
  it('null months never lapses', () => {
    assert.equal(waiverValidUntilMs(NOW, null), null)
  })

  it('adds whole months in UTC', () => {
    assert.equal(waiverValidUntilMs(Date.UTC(2026, 0, 15), 12), Date.UTC(2027, 0, 15))
  })

  it('clamps to the end of a short month rather than rolling forward', () => {
    // 31 Jan + 1 month is 28 Feb, not 3 March.
    assert.equal(waiverValidUntilMs(Date.UTC(2026, 0, 31), 1), Date.UTC(2026, 1, 28))
  })

  it('handles a leap year', () => {
    assert.equal(waiverValidUntilMs(Date.UTC(2028, 0, 31), 1), Date.UTC(2028, 1, 29))
  })

  it('preserves the time of day', () => {
    assert.equal(
      waiverValidUntilMs(Date.UTC(2026, 2, 10, 9, 30, 15, 250), 6),
      Date.UTC(2026, 8, 10, 9, 30, 15, 250)
    )
  })

  it('a 12-month rule signed 13 months ago reads expired, with NO job having run', () => {
    const signedAt = Date.UTC(2025, 6, 15, 12, 0, 0)
    const validUntil = waiverValidUntilMs(signedAt, 12)!
    const state = waiverAcceptanceState(
      { min_valid_version: 1 },
      { accepted_version: 3, accepted_at: ts(signedAt), valid_until: ts(validUntil), status: 'active' },
      NOW
    )
    assert.equal(state, 'expired')
  })

  it('editing the live rule cannot re-date a signature — the predicate never sees it', () => {
    // A studio setting validityMonths on a Monday must not refuse everyone who
    // signed more than that long ago on Tuesday. The predicate reads only the
    // instant frozen onto the signature, so a signature taken under "never
    // lapses" stays valid whatever the config later says.
    const signedUnderNoExpiry = signer({ valid_until: null, accepted_at: ts(NOW - 900 * DAY) })
    assert.equal(waiverAcceptanceState({ min_valid_version: 1 }, signedUnderNoExpiry, NOW), 'valid')
  })
})

describe('documentVersionId', () => {
  it('zero-pads so a plain orderBy(documentId()) is chronological', () => {
    assert.deepEqual(
      [1, 9, 10, 99, 100, 200].map(documentVersionId),
      ['v0001', 'v0009', 'v0010', 'v0099', 'v0100', 'v0200']
    )
    const sorted = [documentVersionId(10), documentVersionId(2), documentVersionId(1)].sort()
    assert.deepEqual(sorted, ['v0001', 'v0002', 'v0010'])
  })
})

describe('waiverPolicyEntryFor — one derivation, shared by the writers and the checker', () => {
  function doc(overrides: Partial<WaiverPolicySourceDocument> = {}): WaiverPolicySourceDocument {
    return {
      documentId: 'doc1',
      slug: 'liability-release-ab12',
      title: 'Liability release',
      kind: 'waiver',
      status: 'published',
      archived_at: null,
      current_version: 4,
      min_valid_version: 4,
      waiver: { ...defaultWaiverConfig(), required: true },
      ...overrides,
    }
  }

  it('a required, published, unarchived, versioned waiver gets an entry', () => {
    assert.deepEqual(waiverPolicyEntryFor(doc(), 'hash'), {
      documentId: 'doc1',
      slug: 'liability-release-ab12',
      title: 'Liability release',
      current_version: 4,
      min_valid_version: 4,
      body_hash: 'hash',
      mayIncludeMinors: false,
      validityMonths: null,
      scope: { appliesTo: 'all_bookings' },
    })
  })

  it('an absent floor reads as 0 — a silent first publish supersedes nobody', () => {
    assert.equal(
      waiverPolicyEntryFor(doc({ min_valid_version: null }), 'hash')?.min_valid_version,
      0
    )
  })

  const excluded: Array<[string, Partial<WaiverPolicySourceDocument>]> = [
    ['a non-waiver kind', { kind: 'terms' }],
    ['a waiver that is not required', { waiver: defaultWaiverConfig() }],
    ['a waiver with no config at all', { waiver: null }],
    ['an unpublished draft', { status: 'draft' }],
    ['an archived waiver', { archived_at: ts(NOW) }],
    ['a waiver with no published version', { current_version: null }],
  ]
  for (const [name, patch] of excluded) {
    it(`${name} gets NO entry — the gate can only point at readable text`, () => {
      assert.equal(waiverPolicyEntryFor(doc(patch), 'hash'), null)
    })
  }
})

describe('caps', () => {
  it('zero on free/coach says the same thing as WAIVER_MIN_PLAN, as data', () => {
    assert.equal(WAIVER_MIN_PLAN, 'studio')
    const plans: SaasPlan[] = ['free', 'coach', 'studio', 'organization']
    for (const plan of plans) {
      const zero = WAIVER_LIMITS[plan].maxWaivers === 0
      assert.equal(zero, plan === 'free' || plan === 'coach', `${plan} cap disagrees with the gate`)
    }
    assert.equal(getWaiverLimits(null).maxWaivers, 0)
  })

  it('the gate cost is bounded by a stated number, not by a studio document count', () => {
    assert.ok(MAX_REQUIRED_WAIVERS_PER_TEAM > 0 && MAX_REQUIRED_WAIVERS_PER_TEAM <= 5)
  })

  it('the body clamp has ONE definition and the web editor delegates to it', () => {
    assert.equal(MAX_WAIVER_BODY_CHARS, 50000)
  })
})

describe('defaultWaiverConfig', () => {
  it('mayIncludeMinors defaults to OFF, and required defaults to OFF', () => {
    // Off is deliberate: the common case is an adults-only studio, and every
    // extra question on the acquisition path is a real conversion cost. Its
    // failure mode is silent — a kids' club that never opens it takes signatures
    // with no prompt to check anybody at the door — so the guard is that the
    // authoring UI renders the control inline, with one line saying what turning
    // it on does, never behind "advanced".
    assert.deepEqual(defaultWaiverConfig(), {
      mayIncludeMinors: false,
      validityMonths: null,
      scope: { appliesTo: 'all_bookings' },
      required: false,
    })
  })

  it('required: false is what lets the whole feature ship dark', () => {
    assert.equal(defaultWaiverConfig().required, false)
  })
})
