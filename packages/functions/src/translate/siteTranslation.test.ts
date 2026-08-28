// Consumer-side fixtures for the shared extractor/resolver
// (@linyup/shared utils/siteTranslation.ts) — this module (translate/) is the
// pipeline that reads their output, so these pin the contract it depends on:
// key stability, the staleness guard, the excluded-field list, org/widget
// sections sharing one extractor, deep-clone, and whitespace handling.
import assert from 'node:assert/strict'
import {
  extractSiteUnits,
  applySiteTranslations,
  applySectionTranslations,
  translationSourceHash,
  type HeroSection,
  type ContentSection,
  type ContactSection,
  type SiteMeta,
  type EmbedWidget,
  type ClubsSection,
  type SiteTranslationUnits,
} from '@linyup/shared'

function hero(id: string, headline: string): HeroSection {
  return { id, type: 'hero', headline, align: 'center' }
}

function content(id: string, heading: string, body: string): ContentSection {
  return { id, type: 'content', heading, body, imageSide: 'left' }
}

describe('translate/siteTranslation (extractor/resolver contract)', () => {
  it('key stability: reordering sections does not change the set of keys', () => {
    const a = [hero('h1', 'Welcome'), content('c1', 'About', '<p>Hi</p>')]
    const b = [content('c1', 'About', '<p>Hi</p>'), hero('h1', 'Welcome')]

    const keysA = extractSiteUnits({ sections: a })
      .map((u) => u.key)
      .sort()
    const keysB = extractSiteUnits({ sections: b })
      .map((u) => u.key)
      .sort()
    assert.deepEqual(keysA, keysB)
    assert.deepEqual(keysA, ['s.c1.body', 's.c1.heading', 's.h1.headline'])
  })

  it('staleness guard: a unit whose srcHash no longer matches the base text is never substituted', () => {
    const sections = [hero('h1', 'Welcome to the studio')]
    const staleUnits: SiteTranslationUnits = {
      's.h1.headline': { text: 'Bienvenue (STALE)', srcHash: translationSourceHash('a different headline entirely') },
    }
    const translated = applySiteTranslations({ sections }, staleUnits)
    assert.equal((translated.sections[0] as HeroSection).headline, 'Welcome to the studio')
  })

  it('staleness guard: a unit whose srcHash matches IS substituted', () => {
    const sections = [hero('h1', 'Welcome to the studio')]
    const freshUnits: SiteTranslationUnits = {
      's.h1.headline': { text: 'Bienvenue au studio', srcHash: translationSourceHash('Welcome to the studio') },
    }
    const translated = applySiteTranslations({ sections }, freshUnits)
    assert.equal((translated.sections[0] as HeroSection).headline, 'Bienvenue au studio')
  })

  it('excluded fields are never extracted: contact address/phone/email, meta.title, place names', () => {
    const contactSection: ContactSection = {
      id: 'ct1',
      type: 'contact',
      heading: 'Find us',
      address: '123 Main St',
      phone: '+41 22 000 00 00',
      email: 'hello@example.com',
      mapQuery: '123 Main St',
      showSocial: false,
    }
    const meta: SiteMeta = {
      title: 'My Studio', // excluded — brand name
      theme: 'light',
      accentColor: '#000',
      font: 'sans',
      header: { showNav: true, ctaAction: 'booking', showSignIn: true },
      footer: { showSocial: true },
    }
    const units = extractSiteUnits({ meta, sections: [contactSection] })
    const keys = units.map((u) => u.key)
    assert.ok(keys.includes('s.ct1.heading'))
    assert.ok(!keys.some((k) => k.includes('address')))
    assert.ok(!keys.some((k) => k.includes('phone')))
    assert.ok(!keys.some((k) => k.includes('email')))
    assert.ok(!keys.some((k) => k.includes('mapQuery')))
    assert.ok(!keys.includes('meta.title'))
    assert.ok(!units.some((u) => u.text === 'My Studio'))
  })

  it('org sections and widget sections extract through the SAME extractor as team sections', () => {
    const clubs: ClubsSection = { id: 'org1', type: 'clubs', heading: 'Our clubs', columns: 3 }
    const widget: EmbedWidget = { id: 'w1', type: 'hero', headline: 'Embedded hero', align: 'left', label: 'Studio-facing label' }

    const orgUnits = extractSiteUnits({ sections: [clubs] })
    assert.deepEqual(
      orgUnits.map((u) => u.key),
      ['s.org1.heading']
    )

    // Widgets ARE WebsiteSections — pass `sections: widgets`.
    const widgetUnits = extractSiteUnits({ sections: [widget] })
    assert.deepEqual(
      widgetUnits.map((u) => u.key),
      ['s.w1.headline']
    )
    // The studio-facing `label` is never extracted.
    assert.ok(!widgetUnits.some((u) => u.text === 'Studio-facing label'))

    const resolvedWidget = applySectionTranslations(widget, {
      's.w1.headline': { text: 'Héros intégré', srcHash: translationSourceHash('Embedded hero') },
    })
    assert.equal(resolvedWidget.headline, 'Héros intégré')
  })

  it('deep-clone: applySiteTranslations never mutates the input site', () => {
    const sections = [hero('h1', 'Welcome')]
    const site = { sections }
    const units: SiteTranslationUnits = {
      's.h1.headline': { text: 'Bienvenue', srcHash: translationSourceHash('Welcome') },
    }
    const translated = applySiteTranslations(site, units)
    assert.equal((site.sections[0] as HeroSection).headline, 'Welcome')
    assert.equal((translated.sections[0] as HeroSection).headline, 'Bienvenue')
    assert.notEqual(translated.sections, site.sections)
  })

  it('whitespace-only source is never extracted', () => {
    const sections = [hero('h1', '   ')]
    const units = extractSiteUnits({ sections })
    assert.deepEqual(units, [])
  })

  it('whitespace-only base text is never substituted, even with a matching stored unit', () => {
    const sections = [hero('h1', '   ')]
    const units: SiteTranslationUnits = {
      's.h1.headline': { text: 'should never appear', srcHash: translationSourceHash('   ') },
    }
    const translated = applySiteTranslations({ sections }, units)
    assert.equal((translated.sections[0] as HeroSection).headline, '   ')
  })
})
