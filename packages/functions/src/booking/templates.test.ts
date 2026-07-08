import assert from 'node:assert/strict'
import { buildBookingConfirmationEmail, instructionsBox } from './templates'

describe('instructionsBox', () => {
  it('escapes studio-authored HTML', () => {
    const html = instructionsBox('<script>alert(1)</script>', 'en')
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  it('turns bare URLs into links', () => {
    const html = instructionsBox('Sign here: https://www.signwell.com/new_doc/abc/', 'en')
    assert.ok(html.includes('<a href="https://www.signwell.com/new_doc/abc/"'))
  })

  it('converts newlines to <br>', () => {
    const html = instructionsBox('line one\nline two', 'en')
    assert.ok(html.includes('line one<br>line two'))
  })

  it('uses the localised heading', () => {
    assert.ok(instructionsBox('x', 'de').includes('Wichtig'))
    assert.ok(instructionsBox('x', 'it').includes('Importante'))
  })
})

describe('buildBookingConfirmationEmail', () => {
  const base = {
    firstname: 'Priya',
    teamName: 'SWIMLI',
    activityName: 'Beginners Squad',
    sessionStart: new Date('2026-07-15T17:30:00Z'),
    sessionEnd: new Date('2026-07-15T18:15:00Z'),
    locationName: 'Schwamendingen Pool',
  }

  it('renders the instructions block when provided', () => {
    const { html, text } = buildBookingConfirmationEmail({
      ...base,
      instructions: 'IMPORTANT!\nPlease sign the Service Agreement: https://example.com/doc',
    })
    assert.ok(html.includes('Important'))
    assert.ok(html.includes('IMPORTANT!'))
    assert.ok(html.includes('<a href="https://example.com/doc"'))
    assert.ok(text.includes('IMPORTANT!'))
  })

  it('omits the block when instructions are absent or blank', () => {
    const without = buildBookingConfirmationEmail(base).html
    const blank = buildBookingConfirmationEmail({ ...base, instructions: '   ' }).html
    // The "Important" heading only appears when a non-blank note is set.
    assert.ok(!without.includes('>Important<'))
    assert.ok(!blank.includes('>Important<'))
  })
})
