import assert from 'node:assert/strict'
import { translateBatchWithGoogle, type GoogleTranslateAuth } from './googleProvider'

interface Captured {
  url: string
  headers: Record<string, string>
  body: {
    contents: string[]
    mimeType: string
    sourceLanguageCode: string
    targetLanguageCode: string
  }
}

/** Stubs `global.fetch` to record every call and answer each content with a
 *  bracketed echo, so tests can assert on both the REQUEST shape (endpoint,
 *  mimeType, language codes) and the response mapping (order). An optional
 *  `short` flag answers with one translation fewer than asked. */
function stubFetch(opts?: { short?: boolean }): { captured: Captured[]; restore: () => void } {
  const captured: Captured[] = []
  const original = global.fetch
  global.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Captured['body']
    captured.push({ url, headers: init.headers, body })
    const translations = body.contents.map((t) => ({ translatedText: `[${t}]` }))
    if (opts?.short) translations.pop()
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ translations }),
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

const auth: GoogleTranslateAuth = {
  projectId: 'test-project',
  getToken: async () => 'test-token',
}

describe('translate/googleProvider — translateBatchWithGoogle', () => {
  it('calls the v3 translateText endpoint for the project, with a bearer token', async () => {
    const { captured, restore } = stubFetch()
    try {
      await translateBatchWithGoogle(auth, {
        texts: [{ text: 'Hi', format: 'plain' }],
        source: 'en',
        target: 'de',
      })
      assert.equal(
        captured[0].url,
        'https://translation.googleapis.com/v3/projects/test-project/locations/global:translateText'
      )
      assert.equal(captured[0].headers.Authorization, 'Bearer test-token')
      assert.equal(captured[0].body.sourceLanguageCode, 'en')
      assert.equal(captured[0].body.targetLanguageCode, 'de')
    } finally {
      restore()
    }
  })

  it('splits a mixed batch by format — text/plain and text/html requests', async () => {
    const { captured, restore } = stubFetch()
    try {
      await translateBatchWithGoogle(auth, {
        texts: [
          { text: 'Plain one', format: 'plain' },
          { text: '<p>Html one</p>', format: 'html' },
          { text: 'Plain two', format: 'plain' },
        ],
        source: 'en',
        target: 'fr',
      })
      assert.equal(captured.length, 2)
      const plainCall = captured.find((c) => c.body.mimeType === 'text/plain')!
      const htmlCall = captured.find((c) => c.body.mimeType === 'text/html')!
      assert.deepEqual(plainCall.body.contents, ['Plain one', 'Plain two'])
      assert.deepEqual(htmlCall.body.contents, ['<p>Html one</p>'])
    } finally {
      restore()
    }
  })

  it('batches at most 50 texts per request', async () => {
    const { captured, restore } = stubFetch()
    try {
      const texts = Array.from({ length: 120 }, (_, i) => ({ text: `t${i}`, format: 'plain' as const }))
      await translateBatchWithGoogle(auth, { texts, source: 'en', target: 'it' })
      assert.deepEqual(
        captured.map((c) => c.body.contents.length),
        [50, 50, 20]
      )
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
      const result = await translateBatchWithGoogle(auth, { texts, source: 'de', target: 'en' })
      assert.deepEqual(result, ['[plain-a]', '[<p>html-a</p>]', '[plain-b]', '[<p>html-b</p>]'])
    } finally {
      restore()
    }
  })

  it("maps a SHORT response to '' for the unanswered text — never the source (hash-cache poisoning)", async () => {
    const { restore } = stubFetch({ short: true })
    try {
      const result = await translateBatchWithGoogle(auth, {
        texts: [
          { text: 'first', format: 'plain' },
          { text: 'second', format: 'plain' },
        ],
        source: 'en',
        target: 'de',
      })
      assert.deepEqual(result, ['[first]', ''])
    } finally {
      restore()
    }
  })
})
