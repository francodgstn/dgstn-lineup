// Ported from hmd-lineup/functions/src/manageTeamMember/index.js
import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { to } from '../utils/async'
import {
  getTeamRole,
  addTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
} from '../utils/teams'
import type { TeamRole } from '@linyup/shared'

// coach sits below manager: the existing precedence checks (only owner may touch
// owner/manager) already treat it like viewer — a manager may add/remove/retitle
// coaches and viewers, only an owner may manage managers/owners.
const VALID_ROLES: TeamRole[] = ['owner', 'manager', 'coach', 'viewer']
const VALID_ACTIONS = ['add', 'remove', 'updateRole', 'setCoach'] as const
type Action = (typeof VALID_ACTIONS)[number]

export const manageTeamMember = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated')

  const callerId = request.auth.uid
  const { teamId, action, userId, role, isCoach } = request.data as {
    teamId: string
    action: Action
    userId: string
    role?: TeamRole
    isCoach?: boolean
  }

  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required')
  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    throw new HttpsError('invalid-argument', `action must be one of: ${VALID_ACTIONS.join(', ')}`)
  }

  const [callerRoleErr, callerRole] = await to(getTeamRole(callerId, teamId))
  if (callerRoleErr) {
    console.error('Error getting caller role:', callerRoleErr)
    throw new HttpsError('internal', 'Failed to verify permissions')
  }
  if (!callerRole) throw new HttpsError('permission-denied', 'You are not a member of this team')
  if (!(['owner', 'manager'] as TeamRole[]).includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only team owners and managers can manage members')
  }

  switch (action) {
    case 'add': {
      if (!userId) throw new HttpsError('invalid-argument', 'userId is required for add action')
      if (!role || !VALID_ROLES.includes(role)) {
        throw new HttpsError('invalid-argument', 'Valid role is required for add action')
      }
      if (role === 'owner' && callerRole !== 'owner') {
        throw new HttpsError('permission-denied', 'Only team owners can add other owners')
      }

      const [addErr] = await to(addTeamMember(teamId, userId, role, callerId))
      if (addErr) {
        console.error('Error adding team member:', addErr)
        throw new HttpsError('internal', `Failed to add team member: ${addErr.message}`)
      }

      return { success: true, message: 'Team member added successfully', userId, role }
    }

    case 'remove': {
      if (!userId) throw new HttpsError('invalid-argument', 'userId is required for remove action')
      if (userId === callerId) throw new HttpsError('failed-precondition', 'You cannot remove yourself from the team')

      const [targetRoleErr, targetRole] = await to(getTeamRole(userId, teamId))
      if (targetRoleErr) {
        console.error('Error getting target user role:', targetRoleErr)
        throw new HttpsError('internal', 'Failed to verify target user permissions')
      }
      if (!targetRole) throw new HttpsError('not-found', 'User is not a member of this team')
      if ((['owner', 'manager'] as TeamRole[]).includes(targetRole) && callerRole !== 'owner') {
        throw new HttpsError('permission-denied', 'Only team owners can remove owners or managers')
      }

      const [removeErr] = await to(removeTeamMember(teamId, userId))
      if (removeErr) {
        console.error('Error removing team member:', removeErr)
        throw new HttpsError('internal', `Failed to remove team member: ${removeErr.message}`)
      }

      return { success: true, message: 'Team member removed successfully', userId }
    }

    case 'updateRole': {
      if (!userId) throw new HttpsError('invalid-argument', 'userId is required for updateRole action')
      if (!role || !VALID_ROLES.includes(role)) {
        throw new HttpsError('invalid-argument', 'Valid role is required for updateRole action')
      }
      if (userId === callerId) throw new HttpsError('failed-precondition', 'You cannot change your own role')

      const [targetRoleErr, targetRole] = await to(getTeamRole(userId, teamId))
      if (targetRoleErr) {
        console.error('Error getting target user role:', targetRoleErr)
        throw new HttpsError('internal', 'Failed to verify target user permissions')
      }
      if (!targetRole) throw new HttpsError('not-found', 'User is not a member of this team')

      // Only owners can change owner/manager roles or assign owner
      if (
        (targetRole === 'owner' || targetRole === 'manager' || role === 'owner') &&
        callerRole !== 'owner'
      ) {
        throw new HttpsError('permission-denied', 'Only team owners can manage owner/manager roles')
      }

      const [updateErr] = await to(updateTeamMemberRole(teamId, userId, role))
      if (updateErr) {
        console.error('Error updating team member role:', updateErr)
        throw new HttpsError('internal', `Failed to update team member role: ${updateErr.message}`)
      }

      return { success: true, message: 'Team member role updated successfully', userId, newRole: role }
    }

    case 'setCoach': {
      if (!userId) throw new HttpsError('invalid-argument', 'userId is required for setCoach action')

      const [targetRoleErr, targetRole] = await to(getTeamRole(userId, teamId))
      if (targetRoleErr) {
        console.error('Error getting target user role:', targetRoleErr)
        throw new HttpsError('internal', 'Failed to verify target user permissions')
      }
      if (!targetRole) throw new HttpsError('not-found', 'User is not a member of this team')

      // Coach is a roster/relationship flag (no capability change), so any owner or
      // manager may toggle it for any member — no role-precedence check needed.
      const next = isCoach !== false // default true
      const [setErr] = await to(
        admin
          .firestore()
          .collection('teams')
          .doc(teamId)
          .collection('team_members')
          .doc(userId)
          .set({ is_coach: next }, { merge: true }),
      )
      if (setErr) {
        console.error('Error setting coach flag:', setErr)
        throw new HttpsError('internal', `Failed to update coach status: ${setErr.message}`)
      }

      return { success: true, message: 'Coach status updated', userId, isCoach: next }
    }

    default:
      throw new HttpsError('invalid-argument', 'Invalid action')
  }
})
