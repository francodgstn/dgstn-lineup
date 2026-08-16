import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ── THE CENSUS: where the gift-cards / promo-codes install gate goes ─────────
 *
 * Gating a shipped feature touches every entry point, and the failure mode is
 * incomplete enumeration — a path nobody listed stays open. So the call sites
 * are re-derived FROM THE SOURCE here rather than written down in prose.
 *
 * THE RULE, and both halves matter:
 *
 *   GATED — creating the thing.        Selling a gift card, minting one at the
 *                                      desk, creating a promo code.
 *
 *   UNGATED — using what exists.       Checking a balance, redeeming, voiding,
 *                                      previewing/reserving/committing a promo,
 *                                      editing or retiring a live code.
 *
 * The second half is not politeness. An outstanding gift card is money the
 * studio has ALREADY TAKEN; refusing to redeem it because somebody unticked a
 * plugin is the studio keeping a customer's money and giving nothing back. And
 * a promo caught mid-checkout belongs to a visitor who did nothing wrong — the
 * same reason the `requirePlan` gate this replaces was creation-only.
 *
 * A new creation path that forgets the gate fails here. So does a redemption
 * path that adds one.
 */

const root = join(__dirname, '..')
const giftCards = readFileSync(join(root, 'connect/giftCards.ts'), 'utf8')
const promoCodes = readFileSync(join(root, 'connect/promoCodes.ts'), 'utf8')

/** The body of one `export const NAME = onCall(...)`, up to the next export. */
function callableBody(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = onCall`)
  assert.notEqual(start, -1, `callable ${name} not found — was it renamed or removed?`)
  const rest = src.slice(start + 1)
  const next = rest.indexOf('\nexport const ')
  return next === -1 ? rest : rest.slice(0, next)
}

const GATED: Array<[string, string, string]> = [
  ['giftCards.ts', 'createGiftCardCheckout', 'selling a NEW card to the public'],
  ['giftCards.ts', 'issueGiftCard', 'minting a card at the desk'],
  ['promoCodes.ts', 'createPromoCode', 'creating a code'],
]

const UNGATED: Array<[string, string, string]> = [
  ['giftCards.ts', 'checkGiftCard', 'reading the balance of a card already sold'],
  ['giftCards.ts', 'voidGiftCard', 'winding DOWN an existing liability'],
  ['promoCodes.ts', 'previewPromoCode', 'a public quote — must never mention plugins'],
  ['promoCodes.ts', 'updatePromoCode', 'editing a code that already exists'],
  ['promoCodes.ts', 'setPromoCodeStatus', 'retiring a code that already exists'],
  ['promoCodes.ts', 'clearPromoRedemption', 'a manager lever over existing state'],
  ['promoCodes.ts', 'releasePromoReservations', 'a manager lever over existing state'],
]

const SRC: Record<string, string> = { 'giftCards.ts': giftCards, 'promoCodes.ts': promoCodes }

describe('the plugin install gate — every creation path, and only those', () => {
  for (const [file, name, why] of GATED) {
    it(`${name} IS gated (${why})`, () => {
      assert.ok(
        /await assertPluginInstalled\(/.test(callableBody(SRC[file], name)),
        `${name} creates something behind a plugin but does not call assertPluginInstalled`
      )
    })
  }

  for (const [file, name, why] of UNGATED) {
    it(`${name} is NOT gated (${why})`, () => {
      assert.ok(
        !/assertPluginInstalled\(/.test(callableBody(SRC[file], name)),
        `${name} consumes something that already exists — gating it would strand a ` +
          `customer's money or a visitor's checkout`
      )
    })
  }

  it('the census covers every onCall in both files, so a NEW one cannot slip past', () => {
    // The point of failure this guards: someone adds `createGiftCardBatch`, does
    // not think about the gate, and no test mentions it. Listing it in GATED or
    // UNGATED is a deliberate decision; being absent from both is not.
    const declared = new Set([...GATED, ...UNGATED].map(([f, n]) => `${f}:${n}`))
    for (const [file, src] of Object.entries(SRC)) {
      for (const m of src.matchAll(/export const (\w+) = onCall/g)) {
        assert.ok(
          declared.has(`${file}:${m[1]}`),
          `${file}:${m[1]} is a callable that no census entry classifies — add it to ` +
            `GATED (it creates) or UNGATED (it consumes what exists) in this file`
        )
      }
    }
  })
})

describe('the plan gate did not survive alongside the plugin gate', () => {
  it('createPromoCode no longer calls requirePlan — one door, one answer', () => {
    // Stacking them would let a Studio user be refused by either and get a
    // different explanation each time. The plan requirement now lives ONLY in
    // the manifest's minPlan.
    //
    // Comments stripped first: the code that removed the call explains itself by
    // NAMING it, so a whole-file search matches prose and fails for the wrong
    // reason (the same trap the document-link href guard hit).
    const live = promoCodes
      .split('\n')
      .filter((l) => {
        const s = l.trim()
        return s && !s.startsWith('//') && !s.startsWith('*') && !s.startsWith('/*')
      })
      .join('\n')
    assert.ok(
      !/requirePlan\(/.test(live),
      'requirePlan is back in promoCodes.ts — the plan requirement belongs in the ' +
        'plugin manifest (minPlan), not in a second runtime gate'
    )
  })

  it('PROMO_CODE_LIMITS still applies as the ceiling', () => {
    assert.ok(
      /await assertUnderActiveCap\(teamId\)/.test(callableBody(promoCodes, 'createPromoCode')),
      'the active-codes cap is a limit, not a door, and must outlive the plan gate'
    )
  })
})

describe('the public mirror stops OFFERING gift cards when uninstalled', () => {
  it('syncTeamPublicProfile gates giftCards on the plugin', () => {
    // The public shop reads nothing but this mirror, so it is the only place an
    // uninstall can take the offer down.
    const sync = readFileSync(join(root, 'sync/syncTeamPublicProfile.ts'), 'utf8')
    assert.ok(/giftCardsPluginActive/.test(sync))
    assert.ok(
      /if \(!giftCardsPluginActive\) return \{ enabled: false, amounts: \[\] \}/.test(sync),
      'an uninstalled team must mirror gift cards as disabled'
    )
  })
})

describe('the seeders install what they seed', () => {
  const scripts = join(root, '../../../scripts')

  it('seed-emulator installs gift-cards beside the demo card', () => {
    // Without this a demo tenant has a gift card in Firestore, an empty Payments
    // tab, and no offer in the shop — discovered mid prospect demo.
    const src = readFileSync(join(scripts, 'seed-emulator.ts'), 'utf8')
    assert.ok(/\.doc\('gift-cards'\)/.test(src))
  })

  it('seed-lead installs gift-cards when the lead profile enables them', () => {
    const src = readFileSync(join(scripts, 'seed-lead.ts'), 'utf8')
    assert.ok(/profile\.giftCards\?\.enabled \? \[\{ id: 'gift-cards' \}\] : \[\]/.test(src))
  })
})
