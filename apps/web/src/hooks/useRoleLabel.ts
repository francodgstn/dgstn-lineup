'use client'

import { useTranslations } from 'next-intl'
import { useAuth } from '@/contexts/AuthContext'
import type { RoleLabelPreset } from '@linyup/shared'

/**
 * Single source for the team's contact ROLE display noun.
 *
 * Role labels are studio-configured in Team.contact_role_label (preset +
 * custom singular/plural). When unset, falls back to the RoleLabel i18n
 * defaults ("Member" / "Members"). Marketing names live only in the RoleLabel
 * namespace of messages/{locale}.json — never hardcode the noun in components.
 */
export function useRoleLabel(): { singular: string; plural: string } {
  const t = useTranslations('RoleLabel')
  const { team } = useAuth()

  const cfg = team?.contact_role_label
  if (cfg?.singular && cfg?.plural) {
    return { singular: cfg.singular, plural: cfg.plural }
  }

  return {
    singular: t('defaultSingular'),
    plural: t('defaultPlural'),
  }
}

/**
 * Returns a translation function for preset label names, used by the settings
 * UI to display e.g. "Student (singular: student, plural: students)".
 */
export function useRoleLabelPresetName(): (preset: RoleLabelPreset) => string {
  const t = useTranslations('RoleLabel')
  return (preset) => t(`preset_${preset}` as Parameters<typeof t>[0])
}
