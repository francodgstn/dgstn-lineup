import type { PluginManifest } from '@linyup/shared'
import { PLUGIN_ADDONS } from '@linyup/shared'

export const referralsManifest: PluginManifest = {
  id: 'referrals',
  nameKey: 'referralsName',
  descriptionKey: 'referralsDescription',
  category: 'engagement',
  minPlan: 'studio',
  status: 'available',
  addon: PLUGIN_ADDONS['referrals'],
  iconName: 'Gift',
  hasOwnerConfig: false,
  navContributions: [
    {
      href: '/plugins/referrals',
      labelKey: 'referralsNavLabel',
      icon: 'Gift',
      minPlan: 'studio',
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
