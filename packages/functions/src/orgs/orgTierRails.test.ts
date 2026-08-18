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
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..')
const WEB = join(SRC, '..', '..', '..', 'apps', 'web', 'src')
const ROOT = join(SRC, '..', '..', '..')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
}
function readWeb(rel: string): string {
  return readFileSync(join(WEB, rel), 'utf8').replace(/\r\n/g, '\n')
}
function readRoot(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}
/** Every .ts file under packages/functions/src, as a path relative to it — so a
 *  named call-site list below is checked against the TREE rather than trusted. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(relative(SRC, full).split('\\').join('/'))
  }
  return out
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
    const phase = billing.split('Phase 1 — lapsed trials')[1].split('Phase 2 — lapsed ORGANISATION')[0]
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

// ─────────────────────────────────────────────────────────────────────────────
// UX-9 — an org trial must END
// ─────────────────────────────────────────────────────────────────────────────

describe('an organisation trial ends (UX-9)', () => {
  const billing = read('saas-billing/index.ts')
  const orgs = read('orgs/index.ts')
  const lifecycle = read('orgs/lifecycle.ts')

  /** The org phase of the daily sweep, sliced out of handleTrialLifecycle. */
  const orgPhase = billing.split('Phase 2 — lapsed ORGANISATION')[1].split('Transitional sweep')[0]

  it('the daily sweep actually reads the organizations collection', () => {
    assert.ok(
      orgPhase.includes('.collection(ORGANIZATIONS_COLLECTION)'),
      'phase 2 must sweep organizations — phase 1 sweeps teams and is forbidden from touching an org’s ' +
        'studios (UX-35), so an org trial that no query selects is a trial that never ends',
    )
    assert.ok(orgPhase.includes("where('plan_status', '==', 'trial')"))
    assert.ok(
      orgPhase.includes("where('trial_ends_at', '<=', nowTs)"),
      'the deadline is READ from the document. Deriving it from `created` would make it un-extendable, ' +
        'and an operator-assisted onboarding is exactly the case that needs to move it',
    )
  })

  it('the same two exemptions hold for an org as for a team', () => {
    assert.ok(orgPhase.includes('flags?.internal || flags?.pilot'))
  })

  it('the sweep hands off to the ONE org wind-down and never improvises one', () => {
    assert.ok(orgPhase.includes("lapseOrganization(orgId, { reason: 'trial_lapsed' })"))
    assert.ok(
      !/plan(_status)?:\s*'/.test(code(orgPhase)),
      'phase 2 must delegate the whole teardown — a second writer here is how the two tiers drift',
    )
  })

  it('the granted length is a named constant, not a number in a callable', () => {
    const create = orgs.split('createOrganization = onCall(')[1].split('\n})')[0]
    assert.ok(create.includes('ORG_TRIAL_DAYS'), 'createOrganization must grant ORG_TRIAL_DAYS')
    assert.ok(
      !/14 \* 24 \* 60 \* 60 \* 1000/.test(code(orgs)),
      'no 14-day trial is granted anywhere any more — a team’s own trial is TRIAL_DAYS (30) and an ' +
        'org’s is ORG_TRIAL_DAYS',
    )
  })

  it('an org trial is never SHORTER than a team’s', () => {
    const plan = readFileSync(join(SRC, '..', '..', 'shared', 'src', 'types', 'plan.ts'), 'utf8')
    const teamDays = Number(/export const TRIAL_DAYS = (\d+)/.exec(plan)![1])
    const orgDays = Number(/export const ORG_TRIAL_DAYS = (\d+)/.exec(plan)![1])
    assert.ok(orgDays >= teamDays, `ORG_TRIAL_DAYS (${orgDays}) must be at least TRIAL_DAYS (${teamDays})`)
  })

  it('a lapsed organisation cannot re-grant the tier by re-inviting its studios', () => {
    const accept = orgs.split('acceptOrgInvitation = onCall(')[1].split('\n})')[0]
    assert.ok(
      /orgPlanStatus !== 'trial' && orgPlanStatus !== 'active'/.test(accept),
      'accepting IS the grant, so it must refuse for an org whose subscription is not live — otherwise ' +
        'the sweep lapses the org, the admin re-invites, and nothing can lapse it again (the sweep ' +
        "selects 'trial' and the org now rests on 'expired')",
    )
    assert.ok(accept.includes("throw new HttpsError('failed-precondition'"))
  })

  it('the query the sweep runs has an index to run on', () => {
    const indexes = JSON.parse(readRoot('firestore.index.json')) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>
    }
    const found = indexes.indexes.some(
      (i) =>
        i.collectionGroup === 'organizations' &&
        i.fields.length >= 2 &&
        i.fields[0].fieldPath === 'plan_status' &&
        i.fields[1].fieldPath === 'trial_ends_at',
    )
    assert.ok(found, 'organizations(plan_status, trial_ends_at) is missing from firestore.index.json')
  })

  it('the org wind-down is idempotent about a studio it already handled', () => {
    assert.ok(
      lifecycle.includes("teamSnap.data()?.plan !== 'free'"),
      'a daily sweep that resumes must not re-downgrade or re-email a studio already on Free',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UX-10 — a lapsed org stops mounting what it no longer pays for
// ─────────────────────────────────────────────────────────────────────────────

describe('a lapsed organisation is torn down like a team (UX-10)', () => {
  const billing = read('saas-billing/index.ts')
  const lifecycle = read('orgs/lifecycle.ts')

  it('ONE writer of the downgrade — the org path calls the team’s, never a copy', () => {
    assert.ok(lifecycle.includes("import { downgradeTeamToFree } from '../saas-billing/downgrade'"))
    assert.ok(
      lifecycle.includes('await downgradeTeamToFree(teamId, { fromTrial })'),
      'every member studio goes to Free through the SHARED path',
    )
    assert.ok(
      !/plan:\s*'free'/.test(code(lifecycle)),
      'orgs/lifecycle.ts must not write the Free plan itself — that is a second downgrade writer',
    )
  })

  it('the callers of the one downgrade are named, and nobody else calls it', () => {
    const callers = ['saas-billing/index.ts', 'orgs/lifecycle.ts']
    for (const f of callers) {
      assert.ok(read(f).includes('downgradeTeamToFree('), `${f} no longer calls downgradeTeamToFree`)
    }
    const exempt = new Set([...callers, 'saas-billing/downgrade.ts'])
    for (const f of sourceFiles()) {
      if (exempt.has(f) || f.endsWith('.test.ts')) continue
      assert.ok(
        !read(f).includes('downgradeTeamToFree('),
        `${f} calls downgradeTeamToFree and is not in the list above — add it there deliberately`,
      )
    }
  })

  it('the org’s own paid surface comes down too', () => {
    assert.ok(lifecycle.includes("where('status', '==', 'active')"))
    assert.ok(
      lifecycle.includes('unpublishSiteForOrg(orgId)'),
      'an org has no installed_plugins trigger (that one is bound to teams/{teamId}/…), so the org ' +
        'site must be torn down explicitly',
    )
  })

  it('dropping a studio to Free BREAKS the org link, deliberately', () => {
    // UX-35s invariant is `org_id ⇒ plan 'organization'`. A Free studio that
    // kept org_id would still merge the org's plugin installs — which an org
    // admin can write from the client — so the membership ends with the plan.
    assert.ok(lifecycle.includes('org_id: FieldValue.delete()'))
    assert.ok(lifecycle.includes("status: 'removed'"))
    assert.ok(lifecycle.includes("removed_reason: 'org_lapsed'"))
  })

  it('the teardown is not one click deep — publishing asks, unpublishing never does', () => {
    const site = read('orgWebsite/index.ts')
    const publish = site.split('publishOrgWebsite = onCall(')[1].split('\n})')[0]
    const unpublish = site.split('unpublishOrgWebsite = onCall(')[1].split('\n})')[0]
    assert.ok(
      publish.includes('await assertOrgSubscriptionLive(orgId)'),
      'the lapse unpublishes the org site but KEEPS the draft, so publishing must ask whether the ' +
        'organisation still pays for that surface',
    )
    assert.ok(
      !unpublish.includes('assertOrgSubscriptionLive'),
      'taking your own page down is always allowed',
    )
    // ONE definition of "is this org paying", read off the document both billing
    // rails write.
    const orgs = read('orgs/index.ts')
    assert.ok(orgs.includes('export async function assertOrgSubscriptionLive('))
  })

  it('a cancelled org subscription routes into the same wind-down', () => {
    assert.ok(billing.includes("lapseOrganization(entityId, { reason: 'subscription_cancelled' })"))
  })

  it('past_due tears NOTHING down — on either tier', () => {
    // Stripe dunning recovers; the teardown does not (course mirrors are
    // deleted and nothing rewrites them, UX-16). A past_due TEAM keeps its plan
    // and its installs and is refused by requirePlan, so a past_due ORG does the
    // same: status propagation and no more.
    const branch = billing.split("} else if (entityType === 'org') {")[1].split('\n    } else {')[0]
    const pastDue = branch.split("update.status === 'past_due'")[1]
    assert.ok(!pastDue.includes('lapseOrganization('), 'past_due must not wind an organisation down')
    assert.ok(pastDue.includes('plan_status: update.status'), 'past_due still propagates the status')
  })
})
