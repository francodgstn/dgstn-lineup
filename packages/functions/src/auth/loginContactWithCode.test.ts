// Unit tests for the member-app plan gate (`client: 'mobile'` on
// loginContactWithCode) — the pure decision (`memberAppAccessForPlan`) and its
// injected-loader wrapper (`filterCandidatesForMemberApp`).
//
// The CALLABLE itself (`loginContactWithCode`, the `onCall` export) reads
// `admin.firestore()` at call time with no injected `db`, so it cannot be
// invoked in a mocha run without an emulator or a live Admin SDK app — same
// constraint documented in `utils/teamNotificationWriters.test.ts`,
// `connect/commitSites.test.ts` and `booking/paidConfirmation.test.ts`. What IS
// testable without either is exactly what decides the app's two outcomes: for
// "a mobile login on a Free-plan team returns appNotIncluded", that is
// `filterCandidatesForMemberApp` returning an empty `eligible` list (which the
// callable turns into `{ verified: true, appNotIncluded: true, teams }` — see
// its call site); for "a web login does not", that is the callable's `data`
// type carrying no `client` field on the web caller (asserted below by reading
// the SOURCE, the same technique `teamNotificationWriters.test.ts` uses for a
// property of the text rather than of a running call).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  memberAppAccessForPlan,
  filterCandidatesForMemberApp,
  type MemberAppCandidate,
  type MemberAppTeamInfo,
} from './loginContactWithCode'
import type { SaasPlan } from '@linyup/shared'

describe('memberAppAccessForPlan — the pure plan gate', () => {
  it('Free never has member_app, whatever the status', () => {
    assert.equal(memberAppAccessForPlan('free', 'active'), false)
    assert.equal(memberAppAccessForPlan('free', 'trial'), false)
    assert.equal(memberAppAccessForPlan(null, null), false)
  })

  it('Coach/Studio/Organization have it while the subscription is active or trialing', () => {
    for (const plan of ['coach', 'studio', 'organization'] as SaasPlan[]) {
      assert.equal(memberAppAccessForPlan(plan, 'active'), true, plan)
      assert.equal(memberAppAccessForPlan(plan, 'trial'), true, plan)
      // Absent status reads as 'trial' — same default as utils/plan.ts's requirePlan.
      assert.equal(memberAppAccessForPlan(plan, undefined), true, plan)
    }
  })

  it('a lapsed subscription closes the door regardless of tier', () => {
    assert.equal(memberAppAccessForPlan('studio', 'past_due'), false)
    assert.equal(memberAppAccessForPlan('organization', 'cancelled'), false)
  })
})

describe('filterCandidatesForMemberApp — the injected-loader wrapper', () => {
  function loaderFrom(teams: Record<string, MemberAppTeamInfo>) {
    return async (teamId: string) => teams[teamId] ?? null
  }

  it('a mobile login on a Free-plan team drops the only match — appNotIncluded shape', async () => {
    const candidates: MemberAppCandidate[] = [{ id: 'c1', teamId: 't-free', firstname: 'A', lastname: 'B' }]
    const result = await filterCandidatesForMemberApp(
      candidates,
      loaderFrom({ 't-free': { plan: 'free', plan_status: 'active', name: 'Free Studio', slug: 'free-studio' } })
    )
    assert.deepEqual(result.eligible, [])
    assert.deepEqual(result.droppedTeams, [{ teamId: 't-free', teamName: 'Free Studio', slug: 'free-studio' }])
  })

  it('keeps a candidate whose team has member_app and drops one that does not', async () => {
    const candidates: MemberAppCandidate[] = [
      { id: 'c1', teamId: 't-free', firstname: 'A', lastname: 'B' },
      { id: 'c2', teamId: 't-studio', firstname: 'C', lastname: 'D' },
    ]
    const result = await filterCandidatesForMemberApp(
      candidates,
      loaderFrom({
        't-free': { plan: 'free', plan_status: 'active', name: 'Free Studio', slug: 'free-studio' },
        't-studio': { plan: 'studio', plan_status: 'active', name: 'Studio Co', slug: 'studio-co' },
      })
    )
    assert.deepEqual(
      result.eligible.map((c) => c.id),
      ['c2']
    )
    assert.deepEqual(result.droppedTeams, [{ teamId: 't-free', teamName: 'Free Studio', slug: 'free-studio' }])
  })

  it('dedupes droppedTeams by teamId', async () => {
    const candidates: MemberAppCandidate[] = [
      { id: 'c1', teamId: 't-free', firstname: 'A', lastname: null },
      { id: 'c2', teamId: 't-free', firstname: 'B', lastname: null },
    ]
    const result = await filterCandidatesForMemberApp(
      candidates,
      loaderFrom({ 't-free': { plan: 'free', plan_status: 'active', name: 'Free Studio', slug: 'free-studio' } })
    )
    assert.equal(result.droppedTeams.length, 1)
  })

  it('a missing team doc is treated as no access (fails closed)', async () => {
    const candidates: MemberAppCandidate[] = [{ id: 'c1', teamId: 't-gone', firstname: null, lastname: null }]
    const result = await filterCandidatesForMemberApp(candidates, loaderFrom({}))
    assert.deepEqual(result.eligible, [])
    assert.deepEqual(result.droppedTeams, [{ teamId: 't-gone', teamName: null, slug: null }])
  })

  it('calls the loader at most once per DISTINCT teamId', async () => {
    let calls = 0
    const loader = async (teamId: string): Promise<MemberAppTeamInfo | null> => {
      calls++
      return { plan: 'studio', plan_status: 'active', name: teamId, slug: teamId }
    }
    const candidates: MemberAppCandidate[] = [
      { id: 'c1', teamId: 't1', firstname: null, lastname: null },
      { id: 'c2', teamId: 't1', firstname: null, lastname: null },
      { id: 'c3', teamId: 't2', firstname: null, lastname: null },
    ]
    await filterCandidatesForMemberApp(candidates, loader)
    assert.equal(calls, 2)
  })
})

describe('the web login is unaffected by the gate — source-level property', () => {
  const src = readFileSync(join(__dirname, 'loginContactWithCode.ts'), 'utf8')

  it('the gate runs only when data.client === "mobile"', () => {
    assert.match(src, /data\.client === 'mobile'/)
  })

  it("the web caller's request shape never sets client — the field is optional and Expo-only", () => {
    assert.match(src, /client\?: 'mobile'/)
  })
})
