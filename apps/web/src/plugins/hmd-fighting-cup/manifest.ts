import type { PluginManifest } from '@linyup/shared'

// A TENANT-SPECIFIC plugin. The id stays `hmd-fighting-cup` on purpose: it is
// heading toward being HMD's whole org-level customization bundle rather than
// just the cup, and it will be renamed as part of that wider change. Renaming
// it now would be a migration of every installed_plugins document, every
// event.type value and the event-type label map, for no benefit — the rename
// has to happen once, with the widening, not twice.
export const hmdFightingCupManifest: PluginManifest = {
  id: 'hmd-fighting-cup',
  nameKey: 'hmdFightingCupName',
  descriptionKey: 'hmdFightingCupDescription',
  category: 'data',
  minPlan: 'studio',
  status: 'available',
  iconName: 'Trophy',
  hasOwnerConfig: false,
  // Discovery allow-list — see PluginAudience in @linyup/shared. Named at the
  // ORG rather than the team because that is where it already lives: the HMD
  // migration org-installs this plugin at `organizations/hmd`
  // (scripts/migration/passes/00-setup.ts, ORG_ID = 'hmd'), and every studio
  // under that org inherits the visibility — so adding a second HMD studio
  // needs no edit here. Add a `teamIds` entry beside it for a one-studio
  // customization that has no org.
  audience: { orgIds: ['hmd'] },
  // No navContributions: this plugin adds no sidebar entry. It surfaces purely
  // as an event type (below) — the Categories tab, custom check-in form, and
  // lineup exports all live on the event detail page.
  eventType: {
    id: 'hmd_fighting_cup',
    nameKey: 'hmdFightingCupEventTypeName',
    icon: 'Trophy',
    hasCategories: true,
    hasCheckinForm: true,
    hasCsvExport: true,
    hasPdfExport: true,
  },
}
