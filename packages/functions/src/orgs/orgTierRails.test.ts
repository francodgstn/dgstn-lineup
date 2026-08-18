/**
 * THREE ORG-TIER CLAIMS THAT ONLY THE SOURCE CAN SETTLE (UX-33 / UX-34 / UX-35).
 *
 * Each of the three is a property of the TEXT — which guard sits in front of a
 * callable, which callable the client actually calls, which field a sweep reads
 * — and two of them cross the functions/web boundary, which is where a
 * correction stops travelling. Same idiom, and for the same reason, as
 * `../saas-billing/billingRails.test.ts` and `../connect/commitSites.test.ts`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const WEB = join(SRC, '..', '..', '..', 'apps', 'web', 'src')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
}
function readWeb(rel: string): string {
  return readFileSync(join(WEB, rel), 'utf8').replace(/\r\n/g, '\n')
}
/** CODE only — the files under test explain the bug in prose, and the prose
 *  necessarily names the thing that must not appear in the code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** The org member rail, named — a member added here must be added below. */
const MEMBER_CALLABLES = ['addOrgMember', 'updateOrgMemberRole', 'removeOrgMember'] as const

// ─────────────────────────────────────────────────────────────────────────────
// UX-34 — the org Members tab called three callables that did not exist
// ─────────────────────────────────────────────────────────────────────────────

describe('org member management (UX-34)', () => {
  const members = read('orgs/members.ts')

  it('every callable the Members tab invokes actually exists', () => {
    const page = readWeb('app/[locale]/(auth)/org/[orgId]/members/page.tsx')
    const invoked = [...page.matchAll(/httpsCallable\(functions,\s*'([^']+)'/g)].map((m) => m[1])
    assert.ok(invoked.length > 0, 'the Members tab invokes no callable at all — did the file move?')
    for (const name of invoked) {
      assert.ok(
        members.includes(`export const ${name} = onCall(`),
        `the Members tab calls '${name}', which is not declared in orgs/members.ts`,
      )
    }
  })

  it('is authorized through org_members, never team_members (UX-75s model)', () => {
    for (const name of MEMBER_CALLABLES) {
      const body = members.split(`export const ${name} = onCall(`)[1]
      assert.ok(body, `${name} is not declared in orgs/members.ts`)
      const decl = body.split('\n})')[0]
      assert.ok(
        decl.includes('await assertOrgAdmin('),
        `${name} does not go through assertOrgAdmin — an unguarded org callable`,
      )
    }
    const src = code(members)
    assert.ok(!/hasTeamRole|assertOwner|assertManager/.test(src),
      'orgs/members.ts must not reach for a team_members check — an org admin has no team_members document')
  })

  it('is exported from the functions entrypoint, or it does not exist at runtime', () => {
    const entry = read('index.ts')
    for (const name of MEMBER_CALLABLES) {
      assert.ok(entry.includes(name), `${name} is not exported from src/index.ts`)
    }
  })

  it('an organisation can never be left with no admin', () => {
    // Both callables that can TAKE an admin away consult the guard, and the
    // guard runs inside the transaction that performs the write — otherwise two
    // admins removing each other concurrently both pass.
    for (const name of ['updateOrgMemberRole', 'removeOrgMember'] as const) {
      const decl = members.split(`export const ${name} = onCall(`)[1].split('\n})')[0]
      assert.ok(decl.includes('assertNotLastAdmin(tx'), `${name} does not guard the last admin`)
      assert.ok(decl.includes('runTransaction'), `${name}'s last-admin guard is outside a transaction`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UX-33 — a door nobody can pay through must not be offered
// ─────────────────────────────────────────────────────────────────────────────

describe('priced doors follow the ability to be paid (UX-33)', () => {
  it('the public profile mirrors BOTH halves of the server-side answer', () => {
    // `loadEnabledTeam` enforces the operator kill-switch and
    // `requireChargeableAccount` the account status; the mirror that public
    // surfaces read must not answer with only one of them.
    const sync = read('sync/syncTeamPublicProfile.ts')
    assert.ok(sync.includes('payments_enabled: paymentsEnabled'))
    const derivation = sync.split('const paymentsEnabled =')[1].split('\n')[0]
    assert.ok(derivation.includes('connectEnabled !== false'), 'the kill-switch half is missing')
    assert.ok(derivation.includes("connectStatus === 'enabled'"), 'the chargeable half is missing')
  })

  it('the shop surface is live only when there is a till', () => {
    const sync = read('sync/syncTeamPublicProfile.ts')
    assert.ok(
      /const shopActive = paymentsEnabled\b/.test(sync),
      'shopActive must derive from paymentsEnabled — a plugin install is not a payment method',
    )
  })

  it('the availability listing drops priced durations the studio cannot charge for', () => {
    const window = read('appointments/window.ts')
    assert.ok(window.includes('const canCharge ='))
    assert.ok(
      window.includes("info.durations.filter((d) => resolveDurationSale(d).mode !== 'priced')"),
      'listAvailability must keep every NON-PRICED duration and drop only the priced ones — ' +
        'being unable to take money is not the same as being free, and a benefit_only ' +
        'length (UX-70) is paid for by a plan the contact already holds',
    )
  })

  it('the booking form suppresses the drop-in and the PRICED trial, never the free one', () => {
    const form = readWeb('app/[locale]/(public)/public/[slug]/booking/BookingForm.tsx')
    const trialDoor = form.split('function trialDoorOpen(')[1].split('\n}')[0]
    assert.ok(
      trialDoor.includes("paymentsEnabled || typeof a.trialPriceAmount !== 'number'"),
      'a FREE trial must stay open when the studio cannot take money',
    )
    const dropIn = form.split('function dropInPriceOf(')[1].split('\n}')[0]
    assert.ok(dropIn.includes('if (!paymentsEnabled) return null'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UX-35 — org_id ⇒ the organisation plan
// ─────────────────────────────────────────────────────────────────────────────

describe('an org-affiliated team does not own its own billing (UX-35)', () => {
  it('the trial sweep never downgrades a team an organisation bills', () => {
    const billing = read('saas-billing/index.ts')
    const phase = billing.split('Phase 1 — lapsed trials')[1].split('Transitional sweep')[0]
    assert.ok(
      /if \(doc\.data\(\)\.org_id\)/.test(phase),
      'handleTrialLifecycle must skip org-affiliated teams — the org subscription governs them',
    )
  })

  it('joining an organisation clears the team’s own trial deadline', () => {
    const orgs = read('orgs/index.ts')
    const accept = orgs.split('acceptOrgInvitation = onCall(')[1].split('\n})')[0]
    assert.ok(
      accept.includes('trial_ends_at: FieldValue.delete()'),
      'a stale trial_ends_at on a team whose status mirrors the org is what made the sweep fire',
    )
    assert.ok(accept.includes("plan: 'organization'"), 'org_id and the plan are set together or not at all')
  })
})
