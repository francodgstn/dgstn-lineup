import assert from 'node:assert/strict'
import { getTranslationProvider } from './provider'

/** Saves/overrides the env keys the selection reads, restoring them whole
 *  afterwards — the deepl factory's emulator path reads FUNCTIONS_EMULATOR and
 *  DEEPL_API_KEY, the google factory reads the project-id trio. */
const ENV_KEYS = [
  'TRANSLATION_PROVIDER',
  'FUNCTIONS_EMULATOR',
  'DEEPL_API_KEY',
  'GCLOUD_PROJECT',
  'GCP_PROJECT',
  'GOOGLE_CLOUD_PROJECT',
] as const

async function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => Promise<void>) {
  const saved = new Map<string, string | undefined>()
  for (const k of ENV_KEYS) {
    saved.set(k, process.env[k])
    delete process.env[k]
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  try {
    await fn()
  } finally {
    for (const k of ENV_KEYS) {
      const v = saved.get(k)
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('translate/provider — getTranslationProvider selection', () => {
  it("'none' disables machine translation", async () => {
    await withEnv({ TRANSLATION_PROVIDER: 'none' }, async () => {
      assert.equal(await getTranslationProvider(), null)
    })
  })

  it("'deepl' resolves the key through the emulator env path", async () => {
    await withEnv(
      { TRANSLATION_PROVIDER: 'deepl', FUNCTIONS_EMULATOR: 'true', DEEPL_API_KEY: 'k:fx' },
      async () => {
        assert.notEqual(await getTranslationProvider(), null)
      }
    )
  })

  it("'google' yields a provider when a project id is present, null when not", async () => {
    await withEnv({ TRANSLATION_PROVIDER: 'google', GCLOUD_PROJECT: 'p' }, async () => {
      assert.notEqual(await getTranslationProvider(), null)
    })
    await withEnv({ TRANSLATION_PROVIDER: 'google' }, async () => {
      assert.equal(await getTranslationProvider(), null)
    })
  })

  it('auto prefers DeepL when its key resolves', async () => {
    await withEnv({ FUNCTIONS_EMULATOR: 'true', DEEPL_API_KEY: 'k' }, async () => {
      assert.notEqual(await getTranslationProvider(), null)
    })
  })

  it('auto in the EMULATOR without a DeepL key stays off (no ADC attempt)', async () => {
    await withEnv({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'p' }, async () => {
      assert.equal(await getTranslationProvider(), null)
    })
  })
})
