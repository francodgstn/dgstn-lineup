/* eslint-disable no-console */
// Google Cloud Translation v3 provider — the only place in the codebase that
// speaks to the Cloud Translation API. Sibling of deeplProvider.ts behind the
// same `TranslationProvider` seam; which one serves a run is decided in
// provider.ts, never here.
//
// Unlike DeepL there is NO API key: inside Cloud Functions the call
// authenticates as the runtime service account via Application Default
// Credentials, and billing lands on the project itself. What the project needs
// instead of a secret: the `translate.googleapis.com` API enabled and
// `roles/cloudtranslate.user` on the runtime service account (see
// docs/site-translations.md → Provider setup).
import { GoogleAuth } from 'google-auth-library'
import type { UiLanguage } from '@linyup/shared'
import type { TranslationProvider } from './types'

// Kept in step with the DeepL chunk size — well under Cloud Translation's own
// per-request limits, and small enough that one failed chunk degrades little.
const MAX_TEXTS_PER_REQUEST = 50

/** What `translateBatchWithGoogle` needs to reach the API — injectable so
 *  tests can exercise batching/order without ADC or the network. */
export interface GoogleTranslateAuth {
  projectId: string
  getToken(): Promise<string>
}

interface GoogleTranslateResponse {
  translations?: { translatedText?: string }[]
}

/**
 * One Cloud Translation call for texts that share a `format` — `mimeType` is a
 * per-REQUEST parameter (like DeepL's tag_handling), so the caller splits mixed
 * batches by format before this is reached.
 */
async function translateChunk(
  auth: GoogleTranslateAuth,
  texts: string[],
  source: UiLanguage,
  target: UiLanguage,
  format: 'plain' | 'html'
): Promise<string[]> {
  if (texts.length === 0) return []

  const url = `https://translation.googleapis.com/v3/projects/${auth.projectId}/locations/global:translateText`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await auth.getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: texts,
      mimeType: format === 'html' ? 'text/html' : 'text/plain',
      sourceLanguageCode: source,
      targetLanguageCode: target,
    }),
    // Bounded wait — same rationale as deeplProvider.ts: the publish callables
    // await this synchronously, and a hung connection is TIME, which the
    // throw-free wrappers can't absorb. Abort turns it into a caught error.
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[google-translate] request failed: ${res.status} ${res.statusText} ${detail}`.trim())
  }

  const json = (await res.json()) as GoogleTranslateResponse
  return (json.translations ?? []).map((t) => t.translatedText ?? '')
}

/**
 * The whole `TranslationProvider.translateBatch` contract, given injected
 * auth. Split first by format (mimeType is per-request), then chunked;
 * results are reassembled into the ORIGINAL input order regardless of
 * chunking. Exported so tests can run it against a stubbed fetch.
 */
export async function translateBatchWithGoogle(
  auth: GoogleTranslateAuth,
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
      const translated = await translateChunk(auth, chunkTexts, req.source, req.target, format)
      chunkIndices.forEach((i, j) => {
        // Short response maps to '' — filtered out by buildSiteTranslations so
        // the unit stays pending, exactly like the DeepL provider. Falling back
        // to the source text would poison the hash cache (see deeplProvider.ts).
        out[i] = translated[j] ?? ''
      })
    }
  }
  return out
}

/**
 * Provider for a KNOWN project id, constructing ADC lazily on first use. Used
 * by the factory below (deployed functions) and by the backfill script, which
 * knows its target project from --project and already runs under ADC for the
 * admin SDK.
 */
export function googleProviderFor(projectId: string): TranslationProvider {
  let googleAuth: GoogleAuth | null = null
  const auth: GoogleTranslateAuth = {
    projectId,
    getToken: async () => {
      googleAuth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
      const token = await googleAuth.getAccessToken()
      if (!token) throw new Error('[google-translate] no ADC access token available')
      return token
    },
  }
  return { translateBatch: (req) => translateBatchWithGoogle(auth, req) }
}

/**
 * The Google provider factory. Returns `null` (with exactly one
 * `console.warn`) when no project id is resolvable — which is also what keeps
 * it quiet on developer machines without a configured project. Credential
 * problems (no ADC, missing role, API not enabled) surface later as ordinary
 * per-call errors, which the throw-free pipeline already degrades.
 */
export function getGoogleTranslationProvider(): TranslationProvider | null {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) {
    console.warn('[translate] no GCP project id in env — Google translation unavailable')
    return null
  }
  return googleProviderFor(projectId)
}
