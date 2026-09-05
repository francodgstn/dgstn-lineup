// THE printable financial statement: one self-contained HTML document carrying
// the trial balance, the P&L and the balance sheet.
//
// ── WHY A DOCUMENT BUILDER AND NOT A `@media print` STYLESHEET ───────────────
// The reports page shows the three reports in TABS, so only one is on screen at
// a time — printing the page would print a third of the statement. Print CSS
// would also have to reach up and hide the authenticated layout's sidebar and
// nav, which is a rule about a page this file knows nothing about.
//
// Building the document instead settles both, and buys the thing that made it
// worth doing: the DOWNLOAD and the PRINT are the same bytes. A studio that
// prints and a studio that emails the file are looking at an identical
// document, and there is no second renderer to drift.
//
// SELF-CONTAINED BY CONSTRUCTION: styles are inline, there are no images, no
// fonts to fetch and NO <script>. The file opens from a mail attachment, from a
// USB stick, from a fiduciary's laptop with no network — and it cannot phone
// home, which matters for a document carrying a studio's books.
//
// It is a MANAGEMENT report, and the footer says so in the app's own words. Do
// not let this grow into something that implies statutory compliance; that
// claim is gated on the per-market advisor review in docs/accounting.md.

import type { BalanceSheet, ProfitAndLoss, TrialBalance } from '@linyup/shared'

/** Every visible string, passed in — the builder holds no copy of its own so
 *  the document speaks the language the studio is using. */
export interface StatementLabels {
  documentTitle: string
  trialBalance: string
  profitAndLoss: string
  balanceSheet: string
  account: string
  debit: string
  credit: string
  balance: string
  revenue: string
  expenses: string
  totalRevenue: string
  totalExpenses: string
  netProfit: string
  assets: string
  liabilities: string
  equity: string
  currentResult: string
  totalAssets: string
  totalLiabilitiesEquity: string
  total: string
  generatedOn: string
  disclaimer: string
}

export interface StatementInput {
  studioName: string
  /** e.g. "2026-09 · Year to date" — already composed by the caller. */
  periodLabel: string
  currency: string
  generatedAt: Date
  /** BCP-47, for the generated-on date only. */
  locale: string
  labels: StatementLabels
  trialBalance: TrialBalance
  pnl: ProfitAndLoss
  balanceSheet: BalanceSheet
  /** The page's own money formatter, so the document and the screen agree. */
  money: (minor: number) => string
}

/** Account names are studio-authored, so every interpolation is escaped. */
function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 36px 48px;
    background: #fff;
    color: #14171a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 12px;
    line-height: 1.5;
  }
  header { border-bottom: 2px solid #14171a; padding-bottom: 12px; margin-bottom: 24px; }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .meta { margin-top: 4px; color: #5b6670; font-size: 11.5px; }
  section { margin-bottom: 28px; }
  h2 {
    margin: 0 0 8px; font-size: 13px; letter-spacing: 0.06em;
    text-transform: uppercase; color: #5b6670; font-weight: 600;
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase;
    color: #5b6670; font-weight: 600; border-bottom: 1px solid #14171a; padding: 5px 8px;
  }
  td { padding: 4px 8px; border-bottom: 1px solid #e5e9ec; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .code { color: #5b6670; width: 62px; }
  tr.total td { border-top: 1px solid #14171a; border-bottom: none; font-weight: 600; padding-top: 6px; }
  tr.grand td { border-top: 2px solid #14171a; border-bottom: none; font-weight: 700; padding-top: 6px; }
  .sub { margin-top: 14px; font-size: 11px; font-weight: 600; color: #14171a; }
  footer { margin-top: 32px; border-top: 1px solid #e5e9ec; padding-top: 10px; color: #5b6670; font-size: 10.5px; }
  /* Each statement starts a fresh page, and a table never splits mid-row. */
  @media print {
    body { padding: 0; font-size: 11px; }
    section { page-break-inside: auto; }
    section + section { page-break-before: always; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
  }
`

function rows(cells: string[][], cls = ''): string {
  return cells.map((r) => `<tr class="${cls}">${r.join('')}</tr>`).join('')
}

export function buildFinanceStatementHtml(input: StatementInput): string {
  const { labels: L, money, trialBalance: tb, pnl, balanceSheet: bs } = input
  const td = (v: string, cls = '') => `<td class="${cls}">${v}</td>`
  const line = (code: string, name: string, ...nums: string[]) =>
    [td(esc(code), 'code'), td(esc(name)), ...nums.map((n) => td(n, 'num'))]

  const trialSection = `
    <section>
      <h2>${esc(L.trialBalance)}</h2>
      <table>
        <thead><tr>
          <th class="code"></th><th>${esc(L.account)}</th>
          <th class="num">${esc(L.debit)}</th>
          <th class="num">${esc(L.credit)}</th>
          <th class="num">${esc(L.balance)}</th>
        </tr></thead>
        <tbody>
          ${rows(tb.rows.map((r) => line(r.code, r.name, money(r.debit), money(r.credit), money(r.balance))))}
          ${rows([[td(''), td(esc(L.total)), td(money(tb.total_debit), 'num'), td(money(tb.total_credit), 'num'), td('', 'num')]], 'total')}
        </tbody>
      </table>
    </section>`

  const pnlSection = `
    <section>
      <h2>${esc(L.profitAndLoss)}</h2>
      <p class="sub">${esc(L.revenue)}</p>
      <table><tbody>
        ${rows(pnl.revenue.map((r) => line(r.code, r.name, money(r.amount))))}
        ${rows([[td(''), td(esc(L.totalRevenue)), td(money(pnl.total_revenue), 'num')]], 'total')}
      </tbody></table>
      <p class="sub">${esc(L.expenses)}</p>
      <table><tbody>
        ${rows(pnl.expenses.map((r) => line(r.code, r.name, money(r.amount))))}
        ${rows([[td(''), td(esc(L.totalExpenses)), td(money(pnl.total_expenses), 'num')]], 'total')}
      </tbody></table>
      <table><tbody>
        ${rows([[td(''), td(esc(L.netProfit)), td(money(pnl.net_profit), 'num')]], 'grand')}
      </tbody></table>
    </section>`

  const bsSection = `
    <section>
      <h2>${esc(L.balanceSheet)}</h2>
      <p class="sub">${esc(L.assets)}</p>
      <table><tbody>
        ${rows(bs.assets.map((r) => line(r.code, r.name, money(r.amount))))}
        ${rows([[td(''), td(esc(L.totalAssets)), td(money(bs.total_assets), 'num')]], 'total')}
      </tbody></table>
      <p class="sub">${esc(L.liabilities)}</p>
      <table><tbody>
        ${rows(bs.liabilities.map((r) => line(r.code, r.name, money(r.amount))))}
      </tbody></table>
      <p class="sub">${esc(L.equity)}</p>
      <table><tbody>
        ${rows(bs.equity.map((r) => line(r.code, r.name, money(r.amount))))}
        ${rows([[td(''), td(esc(L.currentResult)), td(money(bs.current_result), 'num')]])}
        ${rows([[td(''), td(esc(L.totalLiabilitiesEquity)), td(money(bs.total_liabilities_equity), 'num')]], 'total')}
      </tbody></table>
    </section>`

  return `<!doctype html>
<html lang="${esc(input.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.studioName)} — ${esc(L.documentTitle)} — ${esc(input.periodLabel)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>${esc(input.studioName)}</h1>
  <p class="meta">
    ${esc(L.documentTitle)} · ${esc(input.periodLabel)} · ${esc(input.currency)}<br>
    ${esc(L.generatedOn)} ${esc(input.generatedAt.toLocaleString(input.locale))}
  </p>
</header>
${trialSection}
${pnlSection}
${bsSection}
<footer>${esc(L.disclaimer)}</footer>
</body>
</html>`
}

/** Download the document as a single `.html` file. */
export function downloadStatementHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Print the same document. A blank window rather than the current one, so the
 * app's sidebar and nav are simply not there to hide — and what comes out of
 * the printer is byte-for-byte what the download gives.
 *
 * Returns false when the window was blocked, so the caller can say so instead
 * of appearing to do nothing.
 */
export function printStatementHtml(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  // Give the new document a tick to lay out before the print dialog reads it.
  w.setTimeout(() => {
    w.focus()
    w.print()
  }, 250)
  return true
}
