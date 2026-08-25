import assert from 'node:assert/strict'
import {
  noticePlaceholdersIn,
  renderNoticeText,
  platformNoticePlaceholderProblem,
  PLATFORM_NOTICE_TEMPLATES,
  PLATFORM_NOTICE_VARIABLES,
} from '@linyup/shared'

describe('notice placeholders', () => {
  it('finds each token once, in order', () => {
    assert.deepEqual(
      noticePlaceholdersIn('{{change}} on {{effective_date}}, see {{change}}'),
      ['change', 'effective_date']
    )
  })

  it('tolerates inner whitespace', () => {
    assert.deepEqual(noticePlaceholdersIn('{{ effective_date }}'), ['effective_date'])
  })

  it('substitutes what it has', () => {
    const r = renderNoticeText('Effective {{effective_date}}.', { effective_date: '15 September' })
    assert.equal(r.text, 'Effective 15 September.')
    assert.deepEqual(r.missing, [])
  })

  // THE failure this whole feature guards against: a customer reading
  // "takes effect on {{effective_date}}". Leaving the token visible is the
  // point — blanking it produces "takes effect on ", which reads as finished
  // text and would ship unnoticed.
  it('leaves an unresolved token IN PLACE and reports it, rather than blanking it', () => {
    const r = renderNoticeText('Effective {{effective_date}}.', {})
    assert.equal(r.text, 'Effective {{effective_date}}.')
    assert.deepEqual(r.missing, ['effective_date'])
  })

  it('treats an empty or whitespace value as missing, not as a substitution', () => {
    for (const v of ['', '   ']) {
      const r = renderNoticeText('X {{reason}} Y', { reason: v })
      assert.deepEqual(r.missing, ['reason'], `value ${JSON.stringify(v)}`)
      assert.ok(r.text.includes('{{reason}}'))
    }
  })

  it('substitutes every occurrence, not just the first', () => {
    const r = renderNoticeText('{{plan}} and {{plan}}', { plan: 'studio' })
    assert.equal(r.text, 'studio and studio')
  })
})

describe('platformNoticePlaceholderProblem', () => {
  it('passes when every operator value is filled', () => {
    assert.equal(
      platformNoticePlaceholderProblem('Re {{change}}', 'On {{effective_date}}', {
        change: 'a new provider',
        effective_date: '15 September',
      }),
      null
    )
  })

  it('names what is still unfilled', () => {
    const problem = platformNoticePlaceholderProblem('{{change}}', '{{effective_date}}', {
      change: 'x',
    })
    assert.match(problem ?? '', /effective_date/)
  })

  // A recipient-scoped variable is resolved per studio at send time, so asking
  // the operator to type it would be asking for something that cannot be typed.
  it('does NOT demand recipient-scoped values from the operator', () => {
    assert.equal(platformNoticePlaceholderProblem('Hello {{studio_name}}', 'on {{plan}}', {}), null)
  })

  // Almost always a typo for a real variable, and it would otherwise ship
  // verbatim to a customer.
  it('rejects an unknown token', () => {
    const problem = platformNoticePlaceholderProblem('', 'Hi {{studioname}}', {})
    assert.match(problem ?? '', /Unknown placeholder/)
    assert.match(problem ?? '', /studioname/)
  })

  it('reports unknown tokens before unfilled ones — a typo is not a missing value', () => {
    const problem = platformNoticePlaceholderProblem('', '{{nope}} {{change}}', {})
    assert.match(problem ?? '', /Unknown placeholder/)
  })
})

// A template shipping a token no variable declares would be refused by the very
// guard above the moment an operator picked it — caught here instead of there.
describe('the built-in templates only use declared variables', () => {
  const declared = new Set(PLATFORM_NOTICE_VARIABLES.map((v) => v.id))
  for (const t of PLATFORM_NOTICE_TEMPLATES) {
    it(`${t.id}`, () => {
      const used = [...noticePlaceholdersIn(t.subject), ...noticePlaceholdersIn(t.body)]
      for (const id of used) {
        assert.ok(declared.has(id), `template "${t.id}" uses undeclared {{${id}}}`)
      }
    })
  }
})
