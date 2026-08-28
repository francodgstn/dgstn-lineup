/* eslint-disable no-console */
// The ONE place a translation vendor is CHOSEN. Every consumer of machine
// translation (translateSite.ts, onEmbedWidgetsWritten.ts — and through them
// the publish callables and the backfill) resolves its provider here; the
// vendor modules (deeplProvider.ts, googleProvider.ts) never decide anything.
//
// Selection is `TRANSLATION_PROVIDER` (deployed functions env / emulator
// .env.local):
//
//   'deepl'   — DeepL, via the `deepl-api-key` secret (emulator: DEEPL_API_KEY)
//   'google'  — Cloud Translation v3, via ADC (no key; needs the API enabled
//               and roles/cloudtranslate.user on the runtime service account)
//   'none'    — machine translation explicitly off (no warn — this is a choice)
//   unset / 'auto' — DeepL when its key resolves; otherwise, in DEPLOYED
//               functions, Google (a project id is always present there); in
//               the emulator, off — attempting ADC locally by default would
//               produce a noisy failure per publish on most dev machines.
//
// Whatever is picked, a null provider or a failing call can only ever degrade
// a publish to fewer translated locales — never fail it (translateSite.ts).
import type { TranslationProvider } from './types'
import { getDeeplTranslationProvider } from './deeplProvider'
import { getGoogleTranslationProvider } from './googleProvider'

export async function getTranslationProvider(): Promise<TranslationProvider | null> {
  const choice = (process.env.TRANSLATION_PROVIDER ?? 'auto').trim().toLowerCase()

  switch (choice) {
    case 'none':
      return null
    case 'deepl':
      return getDeeplTranslationProvider()
    case 'google':
      return getGoogleTranslationProvider()
    default: {
      if (choice !== 'auto') {
        console.warn(`[translate] unknown TRANSLATION_PROVIDER '${choice}' — using auto`)
      }
      const deepl = await getDeeplTranslationProvider({ silent: true })
      if (deepl) return deepl
      if (process.env.FUNCTIONS_EMULATOR === 'true') {
        console.warn(
          '[translate] no DEEPL_API_KEY in the emulator env — translations skipped ' +
            '(set DEEPL_API_KEY in packages/functions/.env.local, or TRANSLATION_PROVIDER=google to use ADC)'
        )
        return null
      }
      console.warn('[translate] deepl-api-key unavailable — falling back to Google Cloud Translation')
      return getGoogleTranslationProvider()
    }
  }
}
