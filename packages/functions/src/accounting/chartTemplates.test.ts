import assert from 'node:assert/strict'
import {
  CHART_TEMPLATES,
  FINANCE_CATEGORIES,
  FINANCE_SOURCES,
  OPENING_BALANCE_ROLE_ACCOUNTS,
  resolveAccountName,
  templateForCountry,
} from '@linyup/shared'
import type { AccountType, ChartTemplateId, OpeningBalanceRoleAccounts } from '@linyup/shared'

// Structural integrity tests for the chart-of-accounts templates: every
// mapping target must exist in the seed, every journal dimension must be
// covered, and every account needs an English name.
// Run with: pnpm --filter @linyup/functions test

describe('chart templates', () => {
  for (const [id, template] of Object.entries(CHART_TEMPLATES)) {
    describe(id, () => {
      it('has unique account codes', () => {
        const codes = template.accounts.map((a) => a.code)
        assert.equal(new Set(codes).size, codes.length)
      })

      it('has an English name (and the declared locales) on every account', () => {
        for (const acc of template.accounts) {
          assert.ok(acc.names.en, `${id} ${acc.code} missing en name`)
          for (const locale of template.locales) {
            assert.ok(acc.names[locale], `${id} ${acc.code} missing ${locale} name`)
          }
        }
      })

      it('maps every FinanceCategory and FinanceTxnSource to a seeded account', () => {
        const codes = new Set(template.accounts.map((a) => a.code))
        for (const c of FINANCE_CATEGORIES) {
          assert.ok(codes.has(template.mapping.revenue_by_category[c]), `${id} category ${c}`)
        }
        for (const s of FINANCE_SOURCES) {
          assert.ok(codes.has(template.mapping.clearing_by_source[s]), `${id} source ${s}`)
        }
        for (const key of [
          'bank_account',
          'stripe_fee_account',
          'platform_fee_account',
          'chargeback_account',
          'retained_earnings_account',
        ] as const) {
          assert.ok(codes.has(template.mapping[key]), `${id} ${key}`)
        }
      })

      it('gives gift-card revenue an account of its own', () => {
        // The compile break from adding a FinanceCategory is satisfied by ANY
        // code — including the catch-all 'other' account, which would silently
        // re-merge gift-card sales with no-show fees and make the split a no-op.
        // Only a distinct account keeps the bucket separable in the ledger.
        const m = template.mapping.revenue_by_category
        assert.notEqual(m.gift_card, m.other, `${id} gift_card must not reuse the other account`)
      })

      it('seeds every opening-balances wizard role with an account of the right type', () => {
        // The wizard's guided questions resolve to these codes as defaults; a
        // template edit that drops or retypes one silently un-defaults a row.
        const byCode = new Map(template.accounts.map((a) => [a.code, a]))
        const roles = OPENING_BALANCE_ROLE_ACCOUNTS[id as ChartTemplateId]
        const expectedType: Record<keyof OpeningBalanceRoleAccounts, AccountType> = {
          cash: 'asset',
          bank: 'asset',
          receivables: 'asset',
          payables: 'liability',
          ownerLoan: 'liability',
          deferredIncome: 'liability',
          equity: 'equity',
        }
        for (const [role, code] of Object.entries(roles)) {
          const account = byCode.get(code)
          assert.ok(account, `${id} wizard role ${role} points at unseeded account ${code}`)
          assert.equal(
            account!.type,
            expectedType[role as keyof OpeningBalanceRoleAccounts],
            `${id} wizard role ${role} (${code})`
          )
        }
        // The balancing line must be plain equity, not the close's account.
        assert.notEqual(roles.equity, template.mapping.retained_earnings_account, id)
      })

      it('types the mapped accounts sensibly', () => {
        const byCode = new Map(template.accounts.map((a) => [a.code, a]))
        assert.equal(byCode.get(template.mapping.bank_account)!.type, 'asset')
        assert.equal(byCode.get(template.mapping.stripe_fee_account)!.type, 'expense')
        assert.equal(byCode.get(template.mapping.platform_fee_account)!.type, 'expense')
        assert.equal(byCode.get(template.mapping.chargeback_account)!.type, 'revenue') // contra revenue
        assert.equal(byCode.get(template.mapping.retained_earnings_account)!.type, 'equity')
        for (const c of FINANCE_CATEGORIES) {
          assert.equal(byCode.get(template.mapping.revenue_by_category[c])!.type, 'revenue')
        }
        for (const s of FINANCE_SOURCES) {
          assert.equal(byCode.get(template.mapping.clearing_by_source[s])!.type, 'asset')
        }
      })
    })
  }
})

describe('templateForCountry', () => {
  it('routes the initial markets and defaults to ch_kmu', () => {
    assert.equal(templateForCountry('DE'), 'de_skr04')
    assert.equal(templateForCountry('it'), 'it_standard')
    assert.equal(templateForCountry('CH'), 'ch_kmu')
    assert.equal(templateForCountry('FR'), 'ch_kmu')
    assert.equal(templateForCountry(null), 'ch_kmu')
  })
})

describe('resolveAccountName', () => {
  const kasse = CHART_TEMPLATES.ch_kmu.accounts.find((a) => a.code === '1000')!
  it('resolves the team locale with en fallback', () => {
    assert.equal(resolveAccountName(kasse, 'fr'), 'Caisse')
    assert.equal(resolveAccountName(kasse, 'de-CH'), 'Kasse')
    assert.equal(resolveAccountName(kasse, 'pt'), 'Cash') // unsupported → en
  })
})
