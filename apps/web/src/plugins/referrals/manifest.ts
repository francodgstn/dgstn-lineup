import type { PluginManifest } from '@linyup/shared'

export const referralsManifest: PluginManifest = {
  id: 'referrals',
  nameKey: 'referralsName',
  descriptionKey: 'referralsDescription',
  category: 'engagement',
  minPlan: 'club',
  status: 'available',
  iconName: 'Gift',
  hasOwnerConfig: false,
  navContributions: [
    {
      href: '/plugins/referrals',
      labelKey: 'referralsNavLabel',
      icon: 'Gift',
      minPlan: 'club',
    },
  ],
  automationTriggers: [
    {
      id: 'plugin:referrals:referral_created',
      labelKey: 'referralsTriggerCreated',
      icon: 'Gift',
      supportsDelay: true,
    },
    {
      id: 'plugin:referrals:referral_rewarded',
      labelKey: 'referralsTriggerRewarded',
      icon: 'Award',
      supportsDelay: false,
    },
  ],
}
