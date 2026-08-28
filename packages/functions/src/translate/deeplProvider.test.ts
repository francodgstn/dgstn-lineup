import assert from 'node:assert/strict'
import { translateBatchWithKey } from './deeplProvider'

interface Captured {
  url: string
  headers: Record<string, string>
  body: string
}

/** Stubs `global.fetch` to record every call and answer with an
 *  UPPERCASE("<n> texts) response, so tests can assert on both the REQUEST
 *  shape (endpoint, headers, params) and the response mapping (order). */
function stubFetch(): { captured: Captured[]; restore: () => void } {
  const captured: Captured[] = []
  const original = global.fetch
  global.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = init.body
    captured.push({ url, headers: init.headers, body })
    const params = new URLSearchParams(body)
    const texts = params.getAll('text')
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ translations: texts.map((t) => ({ text: `[${t}]` })) }),
      text: async () => '',
    } as unknown as Response
  }) as typeof fetch
  return {
    captured,
    restore: () => {
      global.fetch = original
    },
  }
}

describe('translate/deeplProvider — translateBatchWithKey', () => {
  it('uses the free-tier endpoint for a key ending :fx, and the paid endpoint otherwise', async () => {
    const { captured, restore } = stubFetch()
    try {
      await translateBatchWithKey('abc:fx', { texts: [{ text: 'Hi', format: 'plain' }], source: 'en', target: 'de' })
      await translateBatchWithKey('abc', { texts: [{ text: 'Hi', format: 'plain' }], source: 'en', target: 'de' })
      assert.equal(captured[0].url, 'https://api-free.deepl.com/v2/translate')
      assert.equal(captured[1].url, 'https://api.deepl.com/v2/translate')
    } finally {
      restore()
    }
  })

  it('splits a mixed batch by format — one request per format, tag_handling only on the html one', async () => {
    const { captured, restore } = stubFetch()
    try {
      await translateBatchWithKey('k', {
        texts: [
          { text: 'Plain one', format: 'plain' },
          { text: '<p>Html one</p>', format: 'html' },
          { text: 'Plain two', format: 'plain' },
        ],
        source: 'en',
        target: 'de',
      })
      assert.equal(captured.length, 2)
      const plainCall = captured.find((c) => !c.body.includes('tag_handling'))!
      const htmlCall = captured.find((c) => c.body.includes('tag_handling'))!
      assert.ok(plainCall)
      assert.ok(htmlCall)
      const plainParams = new URLSearchParams(plainCall.body)
      assert.deepEqual(plainParams.getAll('text'), ['Plain one', 'Plain two'])
      const htmlParams = new URLSearchParams(htmlCall.body)
      assert.deepEqual(htmlParams.getAll('text'), ['<p>Html one</p>'])
      assert.equal(htmlParams.get('tag_handling'), 'html')
    } finally {
      restore()
    }
  })

  it('batches at most 50 texts per request', async () => {
    const { captured, restore } = stubFetch()
    try {
      const texts = Array.from({ length: 120 }, (_, i) => ({ text: `t${i}`, format: 'plain' as const }))
      await translateBatchWithKey('k', { texts, source: 'en', target: 'de' })
      assert.equal(captured.length, 3) // 50 + 50 + 20
      const sizes = captured.map((c) => new URLSearchParams(c.body).getAll('text').length)
      assert.deepEqual(sizes, [50, 50, 20])
    } finally {
      restore()
    }
  })

  it("targets 'EN-GB' for English, and uppercases every other locale", async () => {
    const { captured, restore } = stubFetch()
    try {
      await translateBatchWithKey('k', { texts: [{ text: 'Hi', format: 'plain' }], source: 'de', target: 'en' })
      await translateBatchWithKey('k', { texts: [{ text: 'Hi', format: 'plain' }], source: 'en', target: 'fr' })
      const first = new URLSearchParams(captured[0].body)
      const second = new URLSearchParams(captured[1].body)
      assert.equal(first.get('target_lang'), 'EN-GB')
      assert.equal(first.get('source_lang'), 'DE')
      assert.equal(second.get('target_lang'), 'FR')
      assert.equal(second.get('source_lang'), 'EN')
    } finally {
      restore()
    }
  })

  it('preserves input order across chunk/format splitting', async () => {
    const { restore } = stubFetch()
    try {
      const texts = [
        { text: 'plain-a', format: 'plain' as const },
        { text: '<p>html-a</p>', format: 'html' as const },
        { text: 'plain-b', format: 'plain' as const },
        { text: '<p>html-b</p>', format: 'html' as const },
      ]
      const result = await translateBatchWithKey('k', { texts, source: 'en', target: 'de' })
      assert.deepEqual(result, ['[plain-a]', '[<p>html-a</p>]', '[plain-b]', '[<p>html-b</p>]'])
    } finally {
      restore()
    }
  })
})
