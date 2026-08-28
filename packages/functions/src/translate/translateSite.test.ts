import assert from 'node:assert/strict'
import {
  translationSourceHash,
  type TranslatableUnit,
  type SiteTranslationUnits,
} from '@linyup/shared'
import { buildSiteTranslations } from './translateSite'
import type { TranslationProvider } from './types'

/** A counting mock provider — `transform` decides the "translated" text. */
function mockProvider(transform: (text: string, format: 'plain' | 'html') => string): {
  provider: TranslationProvider
  calls: { texts: { text: string; format: 'plain' | 'html' }[] }[]
} {
  const calls: { texts: { text: string; format: 'plain' | 'html' }[] }[] = []
  const provider: TranslationProvider = {
    async translateBatch(req) {
      calls.push({ texts: req.texts })
      return req.texts.map((t) => transform(t.text, t.format))
    },
  }
  return { provider, calls }
}

const uppercase = (text: string) => text.toUpperCase()

describe('translate/translateSite — buildSiteTranslations', () => {
  it('an unchanged source hash costs ZERO provider calls and reuses the stored translation', async () => {
    const units: TranslatableUnit[] = [{ key: 's.h1.headline', text: 'Welcome', format: 'plain' }]
    const previous: Partial<Record<'fr', SiteTranslationUnits>> = {
      fr: { 's.h1.headline': { text: 'Bienvenue', srcHash: translationSourceHash('Welcome') } },
    }
    const { provider, calls } = mockProvider(uppercase)

    const result = await buildSiteTranslations({ units, srcLang: 'en', targets: ['fr'], previous, provider })

    assert.equal(calls.length, 0)
    assert.deepEqual(result.fr, { 's.h1.headline': { text: 'Bienvenue', srcHash: translationSourceHash('Welcome') } })
  })

  it('a single edited unit sends exactly that text to the provider, nothing else', async () => {
    const units: TranslatableUnit[] = [
      { key: 's.h1.headline', text: 'Welcome (v2)', format: 'plain' }, // changed
      { key: 's.h1.subheadline', text: 'Same as before', format: 'plain' }, // unchanged
    ]
    const previous: Partial<Record<'fr', SiteTranslationUnits>> = {
      fr: {
        's.h1.headline': { text: 'Bienvenue', srcHash: translationSourceHash('Welcome') },
        's.h1.subheadline': { text: 'Identique', srcHash: translationSourceHash('Same as before') },
      },
    }
    const { provider, calls } = mockProvider(uppercase)

    const result = await buildSiteTranslations({ units, srcLang: 'en', targets: ['fr'], previous, provider })

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].texts, [{ text: 'Welcome (v2)', format: 'plain' }])
    assert.equal(result.fr!['s.h1.headline'].text, 'WELCOME (V2)')
    assert.equal(result.fr!['s.h1.subheadline'].text, 'Identique') // reused, untouched
  })

  it('pinned is preserved verbatim on a hash match, and cleared on a mismatch', async () => {
    const previous: Partial<Record<'fr', SiteTranslationUnits>> = {
      fr: {
        's.h1.headline': { text: 'Bienvenue (manuel)', srcHash: translationSourceHash('Welcome'), pinned: true },
      },
    }
    const { provider: matchProvider, calls: matchCalls } = mockProvider(uppercase)
    const matched = await buildSiteTranslations({
      units: [{ key: 's.h1.headline', text: 'Welcome', format: 'plain' }],
      srcLang: 'en',
      targets: ['fr'],
      previous,
      provider: matchProvider,
    })
    assert.equal(matchCalls.length, 0)
    assert.equal(matched.fr!['s.h1.headline'].pinned, true)

    const { provider: mismatchProvider } = mockProvider(uppercase)
    const mismatched = await buildSiteTranslations({
      units: [{ key: 's.h1.headline', text: 'Welcome to us', format: 'plain' }], // source changed
      srcLang: 'en',
      targets: ['fr'],
      previous,
      provider: mismatchProvider,
    })
    assert.equal(mismatched.fr!['s.h1.headline'].pinned, undefined)
    assert.equal(mismatched.fr!['s.h1.headline'].text, 'WELCOME TO US')
  })

  it('the reverse index reuses a previous translation for duplicated text under a DIFFERENT key, at zero cost', async () => {
    const units: TranslatableUnit[] = [
      { key: 's.c2.heading', text: 'Book now', format: 'plain' }, // new key, same text as below
    ]
    const previous: Partial<Record<'fr', SiteTranslationUnits>> = {
      fr: { 's.c1.heading': { text: 'Réservez maintenant', srcHash: translationSourceHash('Book now') } },
    }
    const { provider, calls } = mockProvider(uppercase)

    const result = await buildSiteTranslations({ units, srcLang: 'en', targets: ['fr'], previous, provider })

    assert.equal(calls.length, 0)
    assert.equal(result.fr!['s.c2.heading'].text, 'Réservez maintenant')
  })

  it('sanitizes hostile HTML the provider returns before it is ever stored', async () => {
    const units: TranslatableUnit[] = [{ key: 's.c1.body', text: '<p>hi</p>', format: 'html' }]
    const { provider } = mockProvider(() => '<script>alert(1)</script><p>ok</p>')

    const result = await buildSiteTranslations({ units, srcLang: 'en', targets: ['fr'], previous: {}, provider })

    const stored = result.fr!['s.c1.body'].text
    assert.ok(!stored.includes('<script'))
    assert.ok(stored.includes('<p>ok</p>'))
  })

  it('a null provider lets cached units survive and drops units that needed translation', async () => {
    const units: TranslatableUnit[] = [
      { key: 's.h1.headline', text: 'Welcome', format: 'plain' }, // hash match → cached
      { key: 's.h1.subheadline', text: 'Brand new text', format: 'plain' }, // needs translation
    ]
    const previous: Partial<Record<'fr', SiteTranslationUnits>> = {
      fr: { 's.h1.headline': { text: 'Bienvenue', srcHash: translationSourceHash('Welcome') } },
    }

    const result = await buildSiteTranslations({ units, srcLang: 'en', targets: ['fr'], previous, provider: null })

    assert.deepEqual(Object.keys(result.fr!), ['s.h1.headline'])
    assert.equal(result.fr!['s.h1.headline'].text, 'Bienvenue')
  })

  it('the units map is rebuilt from scratch: a key dropped from the source is pruned, not carried forward', async () => {
    const previous: Partial<Record<'fr', SiteTranslationUnits>> = {
      fr: { 's.gone.heading': { text: 'Disparu', srcHash: translationSourceHash('Gone') } },
    }
    const { provider } = mockProvider(uppercase)
    const result = await buildSiteTranslations({ units: [], srcLang: 'en', targets: ['fr'], previous, provider })
    assert.equal(result.fr, undefined) // nothing left ⇒ locale omitted entirely
  })

  it('fixed-point: feeding a run its own output back in reproduces it exactly, with zero provider calls', async () => {
    const units: TranslatableUnit[] = [
      { key: 's.h1.headline', text: 'Welcome', format: 'plain' },
      { key: 's.c1.body', text: '<p>Join us</p>', format: 'html' },
    ]
    const { provider: firstProvider } = mockProvider((t, f) => (f === 'html' ? `<p>${t}</p>` : `[${t}]`))
    const first = await buildSiteTranslations({ units, srcLang: 'en', targets: ['fr'], previous: {}, provider: firstProvider })

    const { provider: secondProvider, calls } = mockProvider(uppercase)
    const second = await buildSiteTranslations({ units, srcLang: 'en', targets: ['fr'], previous: first, provider: secondProvider })

    assert.equal(calls.length, 0)
    assert.deepEqual(second, first)
  })
})
