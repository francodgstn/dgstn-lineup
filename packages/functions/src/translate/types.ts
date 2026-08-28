// The ONE seam between the site-translation pipeline and whatever machine
// translation vendor backs it. `translateSite.ts` and the DeepL provider both
// depend on this shape and nothing wider — a second provider (or a mock, in
// tests) only ever has to implement this.
import type { UiLanguage } from '@linyup/shared'

export interface TranslationProvider {
  /**
   * Translates a batch of texts from `source` to `target`, preserving input
   * order in the returned array (`result[i]` answers `texts[i]`). `format`
   * matters per-text because HTML must be translated with tag-handling on and
   * plain text must not be.
   */
  translateBatch(req: {
    texts: { text: string; format: 'plain' | 'html' }[]
    source: UiLanguage
    target: UiLanguage
  }): Promise<string[]>
}
