import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE THREE WRITERS — asserted against source, not imported.
//
// All three call sites (orgs/index.ts' requestTeamAccess, contacts/
// requestContactUpdate.ts, forms/submitForm.ts) are `onCall` handlers that read
// `admin.firestore()` at module scope with no injected `db`, so they cannot be
// invoked in a mocha run without an emulator or a live Admin SDK app — same
// constraint documented in connect/commitSites.test.ts and
// booking/paidConfirmation.test.ts, and the same technique: read the TypeScript
// SOURCE, because the claim under test ("this call site goes through the ONE
// helper, with a real link") is a property of the text.
//
// createTeamNotification itself (the thing all three route through) IS unit
// tested with a mock db — see teamNotifications.test.ts, sibling file.

const SRC = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
}

/** CODE only — strips comments so a claim discussed in prose (e.g. this file's
 *  own header) is never counted as a call site. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** The index of the first CALL site of `name` — a `function NAME(` definition
 *  is excluded, same technique as connect/commitSites.test.ts's `countCalls`.
 *  Needed because `resolveStaffEmail(teamId: string)` is both defined AND
 *  called in forms/submitForm.ts, and the definition sits well before either
 *  call site this file orders against. */
function callSiteIndex(source: string, name: string): number {
  const re = new RegExp(`(?<!function\\s)\\b${name}\\(`)
  const m = re.exec(source)
  return m ? m.index : -1
}

const WRITERS: Record<string, { file: string; type: string }> = {
  'org access request': { file: 'orgs/index.ts', type: 'org_access_request' },
  'contact update request': { file: 'contacts/requestContactUpdate.ts', type: 'contact_request' },
  'form submission': { file: 'forms/submitForm.ts', type: 'form_submission' },
}

describe('all three team-notification writers route through createTeamNotification', () => {
  for (const [label, { file, type }] of Object.entries(WRITERS)) {
    it(`${label} (${file}) calls createTeamNotification with type '${type}' and a real link`, () => {
      const src = code(read(file))
      assert.ok(src.includes('createTeamNotification('), `${file} must call createTeamNotification`)
      assert.ok(src.includes(`type: '${type}'`), `${file} must set type: '${type}'`)
      // A link is present and not the literal null/empty — "a notification you
      // cannot act on is a dead end" (teamNotification.ts header).
      assert.match(
        src,
        /link:\s*(['"`]\/|`\/)/,
        `${file} must set a non-empty in-app link`
      )
    })
  }

  it('nothing writes team_alerts any more', () => {
    for (const { file } of Object.values(WRITERS)) {
      const src = code(read(file))
      assert.ok(
        !/TEAM_ALERTS_SUBCOLLECTION/.test(src) && !/collection\(['"]team_alerts['"]\)/.test(src),
        `${file} must not write team_alerts`
      )
    }
  })
})

describe("requestContactUpdate's link points at the contacts page's Requests tab", () => {
  it("uses the page's ?tab= convention (useTabParam), not a route that doesn't exist", () => {
    const src = read('contacts/requestContactUpdate.ts')
    assert.ok(src.includes("link: '/contacts?tab=requests'"))
  })
})

describe("submitForm's link points at the form's responses tab", () => {
  it("uses the form detail page's ?tab=responses convention (FORM_TABS)", () => {
    const src = read('forms/submitForm.ts')
    assert.ok(src.includes('link: `/plugins/custom-forms/${data.formId}?tab=responses`'))
  })
})

describe('submitForm: the in-app notification and the staff email are independent', () => {
  // THE BUG THIS PINS: resolveStaffEmail() used to run FIRST, inside the SAME
  // try/catch as the team_alerts write, so an email-lookup failure threw before
  // the in-app notification was ever written — an unrelated mail problem quietly
  // lost the in-app notification as collateral damage. Fixed by splitting into
  // two try/catch blocks, notification first.
  const src = code(read('forms/submitForm.ts'))
  const notifyIdx = callSiteIndex(src, 'createTeamNotification')
  const emailCallIdx = callSiteIndex(src, 'resolveStaffEmail')

  it('both calls exist, createTeamNotification first', () => {
    assert.ok(notifyIdx >= 0, 'createTeamNotification must be called')
    assert.ok(emailCallIdx >= 0, 'resolveStaffEmail must still be called')
    assert.ok(notifyIdx < emailCallIdx, 'the notification write must happen before the email lookup')
  })

  it('the notification sits in its OWN try/catch, closed before resolveStaffEmail runs', () => {
    // The bug this pins: resolveStaffEmail() used to run FIRST, inside the SAME
    // try/catch as the team_alerts write — so an email-lookup failure threw
    // before the alert/notification write ever ran, silently losing the in-app
    // notification as collateral of an unrelated mail problem. Fixed by giving
    // each its own try/catch, notification first, so resolveStaffEmail's catch
    // cannot unwind a promise the notification try has already settled.
    const between = src.slice(notifyIdx, emailCallIdx)
    assert.ok(
      /}\s*catch[\s\S]*?}\s*try\s*{/.test(between),
      'the notification try/catch must close before a new try opens for the email lookup'
    )
  })

  it("the email is gated on the team's form_submission_notification toggle", () => {
    assert.match(
      src,
      /systemEmailEnabledFor\(data\.teamId,\s*'form_submission_notification'\)/,
      'the staff email must be gated on the new toggle'
    )
  })

  it('the notification write is NOT inside the email toggle check (always written)', () => {
    const gateIdx = src.indexOf("systemEmailEnabledFor(data.teamId, 'form_submission_notification')")
    assert.ok(gateIdx >= 0)
    assert.ok(notifyIdx < gateIdx, 'the in-app notification must be written before the email gate is even checked')
  })
})
