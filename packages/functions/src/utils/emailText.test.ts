/**
 * The `text/plain` half of every outbound mail (UX-81).
 *
 * The regression under test is a WELD: `buildEmailTemplate` used to flatten with
 * `.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ')`, which removed each tag without
 * leaving anything in its place, so `<h2>Cosa succede ora</h2><p>Studio…` arrived
 * as `Cosa succede oraStudio…`. Nothing pinned that output — there was no test of
 * the text part anywhere — which is why it survived every template added since.
 * These cases exist so the next flattener change has to argue with something.
 */
import assert from 'node:assert/strict'
import { htmlToPlainText, detailsBox, factLines, ctaButton } from './emailLayout'
import { buildEmailTemplate } from './email'
import { buildProductReceiptEmail } from '../connect/purchaseTemplates'

describe('htmlToPlainText', () => {
  it('separates a titled box from the sentence after it (the UX-81 weld)', () => {
    const html = detailsBox({ title: 'Cosa succede ora', content: '<p style="margin:0;">Studio organizza.</p>' })
    assert.equal(htmlToPlainText(html), 'Cosa succede ora\n\nStudio organizza.')
  })

  it('puts a blank line between paragraphs', () => {
    assert.equal(htmlToPlainText('<p>One.</p>\n<p>Two.</p>'), 'One.\n\nTwo.')
  })

  it('keeps a list tight, one bullet per line', () => {
    assert.equal(
      htmlToPlainText('<p>Changes:</p>\n<ul>\n<li>Monday moves</li>\n<li>New class</li>\n</ul>'),
      'Changes:\n\n- Monday moves\n- New class',
    )
  })

  it('breaks a single line on <br>', () => {
    assert.equal(htmlToPlainText('<p>Arrive early.<br>Bring a towel.</p>'), 'Arrive early.\nBring a towel.')
  })

  it('gives a CTA its target, since a label alone is a dead end', () => {
    assert.equal(
      htmlToPlainText(ctaButton('https://linyup.com/x?t=1', 'Manage booking')),
      'Manage booking (https://linyup.com/x?t=1)',
    )
  })

  it('does not repeat a target that is already the label', () => {
    assert.equal(htmlToPlainText('<a href="mailto:a@b.ch">a@b.ch</a>'), 'a@b.ch')
    assert.equal(htmlToPlainText('<a href="https://a.ch/">https://a.ch</a>'), 'https://a.ch')
  })

  it('names a mailto target without its scheme', () => {
    assert.equal(htmlToPlainText('<p>Ask <a href="mailto:hi@a.ch">the studio</a>.</p>'), 'Ask the studio (hi@a.ch).')
  })

  it('decodes the entities escapeHtml and the copy produce', () => {
    assert.equal(htmlToPlainText('<p>Mat &amp; towel &middot; It&#39;s 18:30 &ndash; 19:30</p>'), "Mat & towel · It's 18:30 – 19:30")
  })

  it('decodes entities last, so escaped markup stays text', () => {
    assert.equal(htmlToPlainText('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'), '<script>alert(1)</script>')
  })

  it('renders a table one row per line, cells tab-separated', () => {
    assert.equal(
      htmlToPlainText('<table><tr><td>Name</td><td>Anna</td></tr><tr><td>Class</td><td>Yoga</td></tr></table>'),
      'Name\tAnna\nClass\tYoga',
    )
  })

  it('never emits more than one blank line, or a leading/trailing one', () => {
    const out = htmlToPlainText('<div><div><p>A</p></div></div>\n\n<hr>\n\n<p>B</p>')
    assert.equal(out, 'A\n\nB')
  })

  it('handles empty and tag-only input', () => {
    assert.equal(htmlToPlainText(''), '')
    assert.equal(htmlToPlainText('<div></div><p></p>'), '')
  })

  it('drops non-rendered elements with their contents', () => {
    assert.equal(htmlToPlainText('<style>p{color:red}</style><p>Hi</p>'), 'Hi')
  })
})

describe('buildEmailTemplate — text part', () => {
  it('underlines the title and flattens the body with its boundaries intact', () => {
    const { text } = buildEmailTemplate({
      title: 'Order confirmed',
      body: `<p>Hi Marco,</p>\n${detailsBox({ content: factLines(['<strong>Item:</strong> Hoodie']) })}`,
    })
    assert.equal(
      text,
      'Order confirmed\n===============\n\nHi Marco,\n\nItem: Hoodie\n\n---\nThis is an automated email from Linyup.\nPlease do not reply.',
    )
  })

  it('breaks the default footer at its <br>', () => {
    const { text } = buildEmailTemplate({ title: 'X', body: '<p>y</p>' })
    assert.ok(text.endsWith('This is an automated email from Linyup.\nPlease do not reply.'))
    assert.ok(!text.includes('Linyup.Please'))
  })
})

describe('a real receipt', () => {
  it('the Italian product receipt no longer welds its heading', () => {
    const { text } = buildProductReceiptEmail({
      firstname: 'Marco',
      teamName: 'Studio Aurora',
      itemLabel: 'Felpa · XL',
      paid: { amount: 65, currency: 'chf' },
      teamEmail: 'ciao@aurora.ch',
      spaceUrl: 'https://linyup.com/public/aurora/space',
      lang: 'it',
    })
    assert.ok(!text.includes('Cosa succede oraStudio'))
    assert.ok(text.includes('Cosa succede ora\n\nStudio Aurora organizza'))
    // The member-area link survives as something a text reader can act on.
    assert.ok(text.includes('area riservata (https://linyup.com/public/aurora/space)'))
  })
})
