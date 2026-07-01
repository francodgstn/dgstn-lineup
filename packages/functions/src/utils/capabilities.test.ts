import assert from 'node:assert/strict'
import {
  resolveRoleCapabilities,
  roleHasCapability,
  dataScopeForRole,
  canManageRole,
  capabilityIsScoped,
  COACH_DEFAULT_CAPABILITIES,
  COACH_ASSIGNABLE_CAPABILITIES,
  ALL_CAPABILITIES,
  ROLE_RANK,
} from '@linyup/shared'

describe('capabilities — system role sets', () => {
  it('owner has every capability', () => {
    for (const c of ALL_CAPABILITIES) assert.equal(roleHasCapability('owner', c), true)
  })

  it('manager has members.manage + offerings but NOT owner-only surfaces', () => {
    assert.equal(roleHasCapability('manager', 'members.manage'), true)
    assert.equal(roleHasCapability('manager', 'offerings.manage'), true)
    assert.equal(roleHasCapability('manager', 'reports.view'), true)
    assert.equal(roleHasCapability('manager', 'billing.manage'), false)
    assert.equal(roleHasCapability('manager', 'integrations.manage'), false)
    assert.equal(roleHasCapability('manager', 'plugins.manage'), false)
    assert.equal(roleHasCapability('manager', 'team.settings'), false)
  })

  it('viewer keeps todays permissive contacts/schedule access but not manager+ surfaces', () => {
    // Faithful to current behaviour: any team member (viewer included) can edit
    // contacts + sessions today.
    assert.equal(roleHasCapability('viewer', 'contacts.view'), true)
    assert.equal(roleHasCapability('viewer', 'contacts.manage'), true)
    assert.equal(roleHasCapability('viewer', 'schedule.manage'), true)
    assert.equal(roleHasCapability('viewer', 'offerings.manage'), false)
    assert.equal(roleHasCapability('viewer', 'members.manage'), false)
    assert.equal(roleHasCapability('viewer', 'reports.view'), false)
  })
})

describe('capabilities — coach role', () => {
  it('defaults to own contacts + schedule (+ full-calendar read)', () => {
    assert.deepEqual(resolveRoleCapabilities('coach'), COACH_DEFAULT_CAPABILITIES)
    assert.equal(roleHasCapability('coach', 'contacts.manage'), true)
    assert.equal(roleHasCapability('coach', 'schedule.view.all'), true)
    assert.equal(roleHasCapability('coach', 'offerings.manage'), false)
    assert.equal(roleHasCapability('coach', 'members.manage'), false)
  })

  it('honours a team override but never grants owner-only or members.manage', () => {
    const override = resolveRoleCapabilities('coach', [
      'contacts.view',
      'reports.view',
      'billing.manage', // must be stripped
      'members.manage', // must be stripped
    ])
    assert.equal(override.includes('contacts.view'), true)
    assert.equal(override.includes('reports.view'), true)
    assert.equal(override.includes('billing.manage'), false)
    assert.equal(override.includes('members.manage'), false)
  })

  it('coach-assignable menu excludes owner-only + members.manage', () => {
    for (const forbidden of ['billing.manage', 'plugins.manage', 'members.manage', 'team.settings'] as const) {
      assert.equal(COACH_ASSIGNABLE_CAPABILITIES.includes(forbidden), false)
    }
  })
})

describe('capabilities — scope + rank', () => {
  it('coach is own-scoped, system roles are all-scoped', () => {
    assert.equal(dataScopeForRole('coach'), 'own')
    assert.equal(dataScopeForRole('owner'), 'all')
    assert.equal(dataScopeForRole('manager'), 'all')
    assert.equal(dataScopeForRole('viewer'), 'all')
  })

  it('rank governs who can manage whom', () => {
    assert.equal(canManageRole('owner', 'manager'), true)
    assert.equal(canManageRole('manager', 'coach'), true)
    assert.equal(canManageRole('manager', 'viewer'), true)
    assert.equal(canManageRole('coach', 'viewer'), true)
    assert.equal(canManageRole('manager', 'owner'), false)
    assert.equal(canManageRole('coach', 'manager'), false)
    assert.equal(canManageRole('viewer', 'viewer'), false)
    assert.ok(ROLE_RANK.owner > ROLE_RANK.manager)
    assert.ok(ROLE_RANK.manager > ROLE_RANK.coach)
    assert.ok(ROLE_RANK.coach > ROLE_RANK.viewer)
  })

  it('scoped flag marks the own-vs-all capabilities', () => {
    assert.equal(capabilityIsScoped('contacts.manage'), true)
    assert.equal(capabilityIsScoped('schedule.manage'), true)
    assert.equal(capabilityIsScoped('offerings.manage'), false)
    assert.equal(capabilityIsScoped('members.manage'), false)
  })
})
