/* eslint-disable no-console */
// DeepL v2 provider — the only place in the codebase that speaks to DeepL.
// Mirrors the mail module's provider-agnostic pattern (mail/brevoProvider.ts):
// a thin, fetch-based client behind the `TranslationProvider` seam, with the
// secret read through the SAME `getSecret` helper every other secret uses
// (`brevo-api-key` → `deepl-api-key`; emulator env `DEEPL_API_KEY`).
import { getSecret } from '../utils/secrets'
import type { UiLanguage } from '@linyup/shared'
import type { TranslationProvider } from './types'

// DeepL API v2 caps a single request at 50 texts.
const MAX_TEXTS_PER_REQUEST = 50

/** Free-tier keys are suffixed ':fx' and live on a different host. */
function endpointFor(apiKey: string): string {
  return apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate'
}

/** DeepL wants 'EN-GB'/'EN-US' for English targets (plain 'EN' is source-only
 *  in newer API versions); every other supported locale is just uppercased. */
function targetLangParam(lang: UiLanguage): string {
  return lang === 'en' ? 'EN-GB' : lang.toUpperCase()
}

function sourceLangParam(lang: UiLanguage): string {
  return lang.toUpperCase()
}

interface DeeplTranslateResponse {
  translations?: { text: string }[]
}

/**
 * One DeepL call for texts that share a `format` — `tag_handling` is a
 * per-REQUEST parameter, not per-text, so a batch containing both plain and
 * HTML must be split by the caller before this is reached (`translateBatchWithKey`
 * does the splitting; this function assumes a single format already).
 */
async function translateChunk(
  apiKey: string,
  texts: string[],
  source: UiLanguage,
  target: UiLanguage,
  format: 'plain' | 'html'
): Promise<string[]> {
  if (texts.length === 0) return []

  const body = new URLSearchParams()
  for (const text of texts) body.append('text', text)
  body.append('source_lang', sourceLangParam(source))
  body.append('target_lang', targetLangParam(target))
  if (format === 'html') body.append('tag_handling', 'html')

  const res = await fetch(endpointFor(apiKey), {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    // Bounded wait, load-bearing: publishWebsite/publishOrgWebsite await this
    // pipeline synchronously inside a 300s callable, and "translation can never
    // fail a publish" only holds for FAILURES — a hung connection is TIME, which
    // the throw-free wrappers can't absorb. Abort turns a black-holed provider
    // into an ordinary caught error (locale degrades, publish proceeds).
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[deepl] translate request failed: ${res.status} ${res.statusText} ${detail}`.trim())
  }

  const json = (await res.json()) as DeeplTranslateResponse
  return (json.translations ?? []).map((t) => t.text)
}

/**
 * The whole `TranslationProvider.translateBatch` contract, given an already-
 * resolved API key. Split first by format (tag_handling is per-request), then
 * chunked to DeepL's 50-texts-per-request cap; results are reassembled into
 * the ORIGINAL input order regardless of chunking. Exported (rather than kept
 * private behind the factory) so tests can exercise batching/splitting without
 * touching Secret Manager or the emulator env fallback.
 */
export async function translateBatchWithKey(
  apiKey: string,
  req: {
    texts: { text: string; format: 'plain' | 'html' }[]
    source: UiLanguage
    target: UiLanguage
  }
): Promise<string[]> {
  const out = new Array<string>(req.texts.length)
  const indicesByFormat: Record<'plain' | 'html', number[]> = { plain: [], html: [] }
  req.texts.forEach((t, i) => indicesByFormat[t.format].push(i))

  for (const format of ['plain', 'html'] as const) {
    const indices = indicesByFormat[format]
    for (let start = 0; start < indices.length; start += MAX_TEXTS_PER_REQUEST) {
      const chunkIndices = indices.slice(start, start + MAX_TEXTS_PER_REQUEST)
      const chunkTexts = chunkIndices.map((i) => req.texts[i].text)
      const translated = await translateChunk(apiKey, chunkTexts, req.source, req.target, format)
      chunkIndices.forEach((i, j) => {
        // A short response (fewer translations than texts) maps to '' — which
        // the consumer (buildSiteTranslations) filters out, leaving the unit
        // pending for a later run. Falling back to the SOURCE text here would
        // store it as a "translation" whose srcHash matches, permanently
        // pinning untranslated text until the source itself changes.
        out[i] = translated[j] ?? ''
      })
    }
  }
  return out
}

/**
 * The DeepL factory. Returns `null` (with exactly one `console.warn`, unless
 * `silent` — provider.ts's auto mode probes with silent and emits its own
 * summary line) when `deepl-api-key` is missing or unreadable. Vendor choice
 * lives in provider.ts, never here.
 */
export async function getDeeplTranslationProvider(
  opts?: { silent?: boolean }
): Promise<TranslationProvider | null> {
  let apiKey: string
  try {
    apiKey = await getSecret('deepl-api-key')
  } catch (err) {
    if (!opts?.silent) {
      console.warn('[translate] deepl-api-key unavailable — translations skipped:', (err as Error).message)
    }
    return null
  }
  if (!apiKey) {
    if (!opts?.silent) console.warn('[translate] deepl-api-key is empty — translations skipped')
    return null
  }
  return {
    translateBatch: (req) => translateBatchWithKey(apiKey, req),
  }
}
