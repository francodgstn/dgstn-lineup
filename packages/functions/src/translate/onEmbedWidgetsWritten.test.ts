// Unit tests for the trigger's PURE compute (`computeEmbedWidgetsI18n`), which
// is what actually decides whether onEmbedWidgetsWritten writes again — no
// emulator, no Firestore doc, matching how the rest of this module is tested.
import assert from 'node:assert/strict'
import type { EmbedWidget } from '@linyup/shared'
import { computeEmbedWidgetsI18n } from './onEmbedWidgetsWritten'
import type { TranslationProvider } from './types'

function widget(id: string, headline: string): EmbedWidget {
  return { id, type: 'hero', headline, align: 'left' }
}

describe('translate/onEmbedWidgetsWritten — computeEmbedWidgetsI18n', () => {
  it('converges to a fixed point when the provider is down: fire 1 writes, fire 2 sees no change', async () => {
    const widgets = [widget('w1', 'Book a class')]

    // Fire 1: no previous i18n, provider down.
    const fire1 = await computeEmbedWidgetsI18n({ srcLang: 'en', widgets, previous: {}, provider: null })
    // With the provider down and nothing to reuse, nothing gets translated.
    assert.deepEqual(fire1.locales, {})

    // Fire 2: the trigger re-fires on its OWN write, so `previous` is now
    // whatever fire 1 produced.
    const fire2 = await computeEmbedWidgetsI18n({ srcLang: 'en', widgets, previous: fire1.locales, provider: null })
    assert.deepEqual(fire2, fire1) // fixed point — the trigger's guard stops here
  })

  it('converges to a fixed point once a provider has actually produced translations', async () => {
    const widgets = [widget('w1', 'Book a class')]
    const provider: TranslationProvider = {
      async translateBatch(req) {
        return req.texts.map((t) => `[${req.target}] ${t.text}`)
      },
    }

    const fire1 = await computeEmbedWidgetsI18n({ srcLang: 'en', widgets, previous: {}, provider })
    assert.ok(Object.keys(fire1.locales).length > 0)

    // Refire with the previous state now equal to fire1's output — a provider
    // that would throw proves zero calls are made on the settled state.
    const throwingProvider: TranslationProvider = {
      async translateBatch() {
        throw new Error('must not be called once converged')
      },
    }
    const fire2 = await computeEmbedWidgetsI18n({
      srcLang: 'en',
      widgets,
      previous: fire1.locales,
      provider: throwingProvider,
    })
    assert.deepEqual(fire2, fire1)
  })
})
