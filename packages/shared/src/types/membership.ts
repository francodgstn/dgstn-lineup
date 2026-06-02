export type MembershipStatusColor = 'gray' | 'yellow' | 'blue' | 'purple' | 'green' | 'red' | 'orange'

export interface OrgMembershipStatusDef {
  id: string
  label: string
  description: string
  color: MembershipStatusColor
  order: number
  isBuiltIn: boolean
  countsAsActive: boolean
  isFinal: boolean
}

export const DEFAULT_ORG_MEMBERSHIP_STATUSES: OrgMembershipStatusDef[] = [
  {
    id: 'guest',
    label: 'Guest',
    description: 'No membership process started.',
    color: 'gray',
    order: 0,
    isBuiltIn: true,
    countsAsActive: false,
    isFinal: false,
  },
  {
    id: 'requested',
    label: 'Requested',
    description: 'Member has submitted a request, awaiting review.',
    color: 'yellow',
    order: 1,
    isBuiltIn: true,
    countsAsActive: false,
    isFinal: false,
  },
  {
    id: 'under_review',
    label: 'Under review',
    description: 'Documents are being reviewed by the organisation.',
    color: 'blue',
    order: 2,
    isBuiltIn: true,
    countsAsActive: false,
    isFinal: false,
  },
  {
    id: 'almost_ready',
    label: 'Almost ready',
    description: 'Review complete, awaiting final confirmation.',
    color: 'purple',
    order: 3,
    isBuiltIn: true,
    countsAsActive: false,
    isFinal: false,
  },
  {
    id: 'active',
    label: 'Active',
    description: 'Valid membership, recognised by the federation.',
    color: 'green',
    order: 4,
    isBuiltIn: true,
    countsAsActive: true,
    isFinal: false,
  },
  {
    id: 'expired',
    label: 'Expired',
    description: 'Membership period has ended. Renewal required.',
    color: 'red',
    order: 5,
    isBuiltIn: true,
    countsAsActive: false,
    isFinal: true,
  },
]
