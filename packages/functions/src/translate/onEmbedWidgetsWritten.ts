/* eslint-disable no-console */
// Keeps embed_widgets/{teamId}.i18n in sync with the widgets on the same doc.
//
// Widgets have no draft/publish split (the config IS the public config — see
// `EmbedWidgetSet` in @linyup/shared), so there is no sidecar-doc write like
// the team/org site: translations ride INLINE under `i18n` on the one public
// doc, written WHOLE by this trigger.
//
// FIXED-POINT GUARD, load-bearing: this trigger writes the very doc it listens
// on, so without a termination check every widget write would refire itself
// forever. `computeEmbedWidgetsI18n` (the pure part, exported for tests) is
// deterministic given the same `widgets` + `previous i18n` + provider outcome,
// so recomputing against the state THIS trigger just wrote reproduces it
// exactly — the guard compares the freshly computed result to `after.i18n` and
// returns without writing when they already agree. That is what stops the
// loop, not a generation counter or a self-write flag.
import * as admin from 'firebase-admin'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import {
  TEAMS_COLLECTION,
  PUBLIC_LOCALES,
  extractSiteUnits,
  resolveSiteSourceLocale,
  type EmbedWidget,
  type SiteTranslationUnits,
  type UiLanguage,
} from '@linyup/shared'
import { getTranslationProvider } from './provider'
import { buildSiteTranslations } from './translateSite'
import type { TranslationProvider } from './types'

export interface EmbedWidgetsI18n {
  srcLang: UiLanguage
  locales: Partial<Record<UiLanguage, SiteTranslationUnits>>
}

function i18nEqual(a: EmbedWidgetsI18n | undefined, b: EmbedWidgetsI18n): boolean {
  if (!a) return false
  if (a.srcLang !== b.srcLang) return false
  const aKeys = Object.keys(a.locales) as UiLanguage[]
  const bKeys = Object.keys(b.locales) as UiLanguage[]
  if (aKeys.length !== bKeys.length) return false
  for (const locale of bKeys) {
    const aUnits = a.locales[locale]
    const bUnits = b.locales[locale]
    if (!aUnits || !bUnits) return false
    const aUnitKeys = Object.keys(aUnits)
    const bUnitKeys = Object.keys(bUnits)
    if (aUnitKeys.length !== bUnitKeys.length) return false
    for (const key of bUnitKeys) {
      const au = aUnits[key]
      const bu = bUnits[key]
      if (!au) return false
      if (au.text !== bu.text || au.srcHash !== bu.srcHash || !!au.pinned !== !!bu.pinned) return false
    }
  }
  return true
}

/**
 * The pure compute this trigger is built around — every source read (the
 * team's authoring language, the widgets, the previous inline map) is passed
 * in, every side effect (the provider call inside `buildSiteTranslations`) is
 * behind the `provider` seam, so this is unit-testable without the emulator.
 */
export async function computeEmbedWidgetsI18n(args: {
  srcLang: UiLanguage
  widgets: readonly EmbedWidget[]
  previous: Partial<Record<UiLanguage, SiteTranslationUnits>>
  provider: TranslationProvider | null
}): Promise<EmbedWidgetsI18n> {
  const { srcLang, widgets, previous, provider } = args
  const units = extractSiteUnits({ sections: widgets })
  const targets = (PUBLIC_LOCALES as readonly UiLanguage[]).filter((l) => l !== srcLang)
  const locales = await buildSiteTranslations({ units, srcLang, targets, previous, provider })
  return { srcLang, locales }
}

export const onEmbedWidgetsWritten = onDocumentWritten('embed_widgets/{teamId}', async (event) => {
  const after = event.data?.after
  if (!after || !after.exists) return

  const { teamId } = event.params
  const data = after.data() as { widgets?: EmbedWidget[]; i18n?: EmbedWidgetsI18n } | undefined
  if (!data) return

  try {
    const db = admin.firestore()
    const teamSnap = await db.collection(TEAMS_COLLECTION).doc(teamId).get()
    const srcLang = resolveSiteSourceLocale(teamSnap.data())
    const provider = await getTranslationProvider()

    const next = await computeEmbedWidgetsI18n({
      srcLang,
      widgets: data.widgets ?? [],
      previous: data.i18n?.locales ?? {},
      provider,
    })

    if (i18nEqual(data.i18n, next)) return // fixed point — nothing to write

    // Whole-field update, never merge: a merge would DEEP-merge `locales` and
    // leave a deleted widget's stale units behind under an unrelated key.
    await after.ref.update({ i18n: next })
  } catch (err) {
    console.warn(`[translate] onEmbedWidgetsWritten failed for team ${teamId} — widgets left untranslated:`, (err as Error).message)
  }
})
