// Chart-of-accounts templates — one per initial market. Each template is pure
// seed data: ~29 accounts (code, type, localized names) plus its own default
// journal-dimension → account mapping. The posting engine is template-agnostic
// (it reads codes exclusively from AccountingSettings.mapping), so adding a
// market is a data change, not an engine change.
//
//   ch_kmu      Swiss KMU Kontenrahmen           (names de/fr/it/en)
//   de_skr04    German SKR04 / DATEV numbering   (names de/en)
//   it_standard Italian piano dei conti (civil-code structure — Italy mandates
//               no national numbering)           (names it/en)
//
// Account names are seeded in the TEAM's locale and stored as plain editable
// strings (user data — they don't follow later UI-language switches).
//
// ⚠ Marked `beta` deliberately: the seeds and the posting map need a fiscal
// advisor's review per market before real customers rely on them.

import type {
  AccountType,
  AccountingMapping,
  ChartTemplateId,
} from '../types/accounting'

export type ChartLocale = 'de' | 'fr' | 'it' | 'en'

export interface ChartTemplateAccount {
  code: string
  type: AccountType
  names: Partial<Record<ChartLocale, string>>
}

export interface ChartTemplate {
  id: ChartTemplateId
  /** Locales this template ships names for (en is always present). */
  locales: ChartLocale[]
  accounts: ChartTemplateAccount[]
  mapping: AccountingMapping
}

// Compact builder keeps the tables readable.
const a = (
  code: string,
  type: AccountType,
  names: Partial<Record<ChartLocale, string>>
): ChartTemplateAccount => ({ code, type, names })

// ─── ch_kmu — Swiss KMU Kontenrahmen ─────────────────────────────────────────

const CH_KMU: ChartTemplate = {
  id: 'ch_kmu',
  locales: ['de', 'fr', 'it', 'en'],
  accounts: [
    // Assets
    a('1000', 'asset', { de: 'Kasse', fr: 'Caisse', it: 'Cassa', en: 'Cash' }),
    a('1020', 'asset', { de: 'Bank', fr: 'Banque', it: 'Banca', en: 'Bank' }),
    a('1022', 'asset', { de: 'Clearing Stripe Connect', fr: 'Compte d’attente Stripe Connect', it: 'Conto transitorio Stripe Connect', en: 'Stripe Connect clearing' }),
    a('1023', 'asset', { de: 'Clearing Stripe (eigenes Konto)', fr: 'Compte d’attente Stripe (propre compte)', it: 'Conto transitorio Stripe (conto proprio)', en: 'Stripe (own account) clearing' }),
    a('1024', 'asset', { de: 'Clearing Payrexx', fr: 'Compte d’attente Payrexx', it: 'Conto transitorio Payrexx', en: 'Payrexx clearing' }),
    a('1100', 'asset', { de: 'Debitoren', fr: 'Débiteurs', it: 'Crediti verso clienti', en: 'Accounts receivable' }),
    a('1300', 'asset', { de: 'Aktive Rechnungsabgrenzung', fr: 'Actifs de régularisation', it: 'Ratei e risconti attivi', en: 'Prepaid expenses / accrued income' }),
    // Liabilities
    a('2000', 'liability', { de: 'Kreditoren', fr: 'Créanciers', it: 'Debiti verso fornitori', en: 'Accounts payable' }),
    a('2200', 'liability', { de: 'Geschuldete MWST', fr: 'TVA due', it: 'IVA dovuta', en: 'VAT payable' }),
    a('2300', 'liability', { de: 'Passive Rechnungsabgrenzung', fr: 'Passifs de régularisation', it: 'Ratei e risconti passivi', en: 'Deferred income / accrued expenses' }),
    a('2400', 'liability', { de: 'Darlehen Inhaber', fr: 'Prêt du propriétaire', it: 'Prestito del titolare', en: 'Owner loan' }),
    // Equity
    a('2800', 'equity', { de: 'Eigenkapital', fr: 'Capital propre', it: 'Capitale proprio', en: 'Equity' }),
    a('2979', 'equity', { de: 'Gewinn-/Verlustvortrag', fr: 'Report de bénéfice/perte', it: 'Utili/perdite riportati', en: 'Retained earnings' }),
    // Revenue
    a('3400', 'revenue', { de: 'Ertrag Mitgliedschaften', fr: 'Produits des abonnements', it: 'Ricavi abbonamenti', en: 'Membership revenue' }),
    a('3401', 'revenue', { de: 'Ertrag Einzeleintritte', fr: 'Produits des entrées uniques', it: 'Ricavi ingressi singoli', en: 'Drop-in revenue' }),
    a('3402', 'revenue', { de: 'Ertrag Kurse', fr: 'Produits des cours', it: 'Ricavi corsi', en: 'Course revenue' }),
    a('3403', 'revenue', { de: 'Ertrag Produkteverkauf', fr: 'Produits de la vente de produits', it: 'Ricavi vendita prodotti', en: 'Product sales revenue' }),
    a('3409', 'revenue', { de: 'Übriger Ertrag', fr: 'Autres produits', it: 'Altri ricavi', en: 'Other revenue' }),
    a('3901', 'revenue', { de: 'Rückbuchungen (Chargebacks)', fr: 'Rétrofacturations (chargebacks)', it: 'Storni (chargeback)', en: 'Chargebacks (contra revenue)' }),
    // Expenses
    a('5000', 'expense', { de: 'Personalaufwand', fr: 'Charges de personnel', it: 'Costi del personale', en: 'Personnel expenses' }),
    a('6000', 'expense', { de: 'Raumaufwand / Miete', fr: 'Charges de locaux / loyer', it: 'Costi locali / affitto', en: 'Premises / rent' }),
    a('6040', 'expense', { de: 'Energie & Nebenkosten', fr: 'Énergie et charges', it: 'Energia e spese accessorie', en: 'Utilities' }),
    a('6100', 'expense', { de: 'Unterhalt & Geräte', fr: 'Entretien & équipement', it: 'Manutenzione e attrezzature', en: 'Maintenance & equipment' }),
    a('6300', 'expense', { de: 'Versicherungen', fr: 'Assurances', it: 'Assicurazioni', en: 'Insurance' }),
    a('6500', 'expense', { de: 'Verwaltungsaufwand', fr: 'Frais d’administration', it: 'Spese amministrative', en: 'Administration' }),
    a('6520', 'expense', { de: 'Verbandsbeiträge', fr: 'Cotisations aux fédérations', it: 'Quote federazioni', en: 'Federation fees' }),
    a('6570', 'expense', { de: 'Informatik / Software', fr: 'Informatique / logiciels', it: 'Informatica / software', en: 'IT / software' }),
    a('6600', 'expense', { de: 'Werbung & Marketing', fr: 'Publicité & marketing', it: 'Pubblicità e marketing', en: 'Advertising & marketing' }),
    a('6900', 'expense', { de: 'Übriger Betriebsaufwand', fr: 'Autres charges d’exploitation', it: 'Altri costi d’esercizio', en: 'Other operating expenses' }),
    a('6940', 'expense', { de: 'Zahlungsgebühren (Stripe/Payrexx)', fr: 'Frais de paiement (Stripe/Payrexx)', it: 'Commissioni di pagamento (Stripe/Payrexx)', en: 'Payment fees (Stripe/Payrexx)' }),
    a('6941', 'expense', { de: 'Plattformgebühren (Linyup)', fr: 'Frais de plateforme (Linyup)', it: 'Commissioni piattaforma (Linyup)', en: 'Platform fees (Linyup)' }),
  ],
  mapping: {
    revenue_by_category: {
      membership: '3400',
      drop_in: '3401',
      course: '3402',
      product: '3403',
      other: '3409',
    },
    clearing_by_source: {
      connect: '1022',
      byo_stripe: '1023',
      payrexx: '1024',
      manual: '1000',
    },
    bank_account: '1020',
    stripe_fee_account: '6940',
    platform_fee_account: '6941',
    chargeback_account: '3901',
    retained_earnings_account: '2979',
  },
}

// ─── de_skr04 — German SKR04 (DATEV) numbering ───────────────────────────────

const DE_SKR04: ChartTemplate = {
  id: 'de_skr04',
  locales: ['de', 'en'],
  accounts: [
    // Assets
    a('1600', 'asset', { de: 'Kasse', en: 'Cash' }),
    a('1800', 'asset', { de: 'Bank', en: 'Bank' }),
    a('1460', 'asset', { de: 'Geldtransit Stripe Connect', en: 'Stripe Connect clearing' }),
    a('1461', 'asset', { de: 'Geldtransit Stripe (eigenes Konto)', en: 'Stripe (own account) clearing' }),
    a('1462', 'asset', { de: 'Geldtransit Payrexx', en: 'Payrexx clearing' }),
    a('1200', 'asset', { de: 'Forderungen aus Lieferungen und Leistungen', en: 'Accounts receivable' }),
    a('1900', 'asset', { de: 'Aktive Rechnungsabgrenzung', en: 'Prepaid expenses' }),
    // Liabilities
    a('3300', 'liability', { de: 'Verbindlichkeiten aus Lieferungen und Leistungen', en: 'Accounts payable' }),
    a('3800', 'liability', { de: 'Umsatzsteuer', en: 'VAT payable' }),
    a('3900', 'liability', { de: 'Passive Rechnungsabgrenzung', en: 'Deferred income' }),
    a('3560', 'liability', { de: 'Darlehen Inhaber/Gesellschafter', en: 'Owner loan' }),
    // Equity
    a('2000', 'equity', { de: 'Eigenkapital', en: 'Equity' }),
    a('2970', 'equity', { de: 'Gewinnvortrag / Verlustvortrag', en: 'Retained earnings' }),
    // Revenue
    a('4400', 'revenue', { de: 'Erlöse Mitgliedsbeiträge', en: 'Membership revenue' }),
    a('4401', 'revenue', { de: 'Erlöse Einzeleintritte', en: 'Drop-in revenue' }),
    a('4402', 'revenue', { de: 'Erlöse Kurse', en: 'Course revenue' }),
    a('4403', 'revenue', { de: 'Erlöse Warenverkauf', en: 'Product sales revenue' }),
    a('4409', 'revenue', { de: 'Sonstige Erlöse', en: 'Other revenue' }),
    a('4700', 'revenue', { de: 'Erlösschmälerungen (Chargebacks)', en: 'Chargebacks (contra revenue)' }),
    // Expenses
    a('6000', 'expense', { de: 'Löhne und Gehälter', en: 'Personnel expenses' }),
    a('6310', 'expense', { de: 'Miete', en: 'Premises / rent' }),
    a('6325', 'expense', { de: 'Gas, Strom, Wasser', en: 'Utilities' }),
    a('6470', 'expense', { de: 'Instandhaltung & Geräte', en: 'Maintenance & equipment' }),
    a('6400', 'expense', { de: 'Versicherungen', en: 'Insurance' }),
    a('6420', 'expense', { de: 'Beiträge (Verbände)', en: 'Federation fees' }),
    a('6800', 'expense', { de: 'Verwaltungsaufwand', en: 'Administration' }),
    a('6837', 'expense', { de: 'EDV / Software', en: 'IT / software' }),
    a('6600', 'expense', { de: 'Werbung & Marketing', en: 'Advertising & marketing' }),
    a('6300', 'expense', { de: 'Sonstige betriebliche Aufwendungen', en: 'Other operating expenses' }),
    a('6855', 'expense', { de: 'Nebenkosten des Geldverkehrs (Zahlungsgebühren)', en: 'Payment fees' }),
    a('6856', 'expense', { de: 'Plattformgebühren (Linyup)', en: 'Platform fees (Linyup)' }),
  ],
  mapping: {
    revenue_by_category: {
      membership: '4400',
      drop_in: '4401',
      course: '4402',
      product: '4403',
      other: '4409',
    },
    clearing_by_source: {
      connect: '1460',
      byo_stripe: '1461',
      payrexx: '1462',
      manual: '1600',
    },
    bank_account: '1800',
    stripe_fee_account: '6855',
    platform_fee_account: '6856',
    chargeback_account: '4700',
    retained_earnings_account: '2970',
  },
}

// ─── it_standard — Italian piano dei conti (civil-code structure) ─────────────

const IT_STANDARD: ChartTemplate = {
  id: 'it_standard',
  locales: ['it', 'en'],
  accounts: [
    // Assets
    a('1000', 'asset', { it: 'Cassa', en: 'Cash' }),
    a('1200', 'asset', { it: 'Banca c/c', en: 'Bank' }),
    a('1210', 'asset', { it: 'Conto transitorio Stripe Connect', en: 'Stripe Connect clearing' }),
    a('1211', 'asset', { it: 'Conto transitorio Stripe (conto proprio)', en: 'Stripe (own account) clearing' }),
    a('1212', 'asset', { it: 'Conto transitorio Payrexx', en: 'Payrexx clearing' }),
    a('1400', 'asset', { it: 'Crediti verso clienti', en: 'Accounts receivable' }),
    a('1500', 'asset', { it: 'Ratei e risconti attivi', en: 'Prepaid expenses' }),
    // Liabilities
    a('2400', 'liability', { it: 'Debiti verso fornitori', en: 'Accounts payable' }),
    a('2600', 'liability', { it: 'IVA a debito', en: 'VAT payable' }),
    a('2500', 'liability', { it: 'Ratei e risconti passivi', en: 'Deferred income' }),
    a('2700', 'liability', { it: 'Finanziamento titolare/soci', en: 'Owner loan' }),
    // Equity
    a('2800', 'equity', { it: 'Patrimonio netto', en: 'Equity' }),
    a('2900', 'equity', { it: 'Utili (perdite) portati a nuovo', en: 'Retained earnings' }),
    // Revenue
    a('3000', 'revenue', { it: 'Ricavi abbonamenti', en: 'Membership revenue' }),
    a('3001', 'revenue', { it: 'Ricavi ingressi singoli', en: 'Drop-in revenue' }),
    a('3002', 'revenue', { it: 'Ricavi corsi', en: 'Course revenue' }),
    a('3003', 'revenue', { it: 'Ricavi vendita prodotti', en: 'Product sales revenue' }),
    a('3009', 'revenue', { it: 'Altri ricavi', en: 'Other revenue' }),
    a('3100', 'revenue', { it: 'Resi e storni (chargeback)', en: 'Chargebacks (contra revenue)' }),
    // Expenses
    a('4000', 'expense', { it: 'Costi del personale', en: 'Personnel expenses' }),
    a('4100', 'expense', { it: 'Affitti e locali', en: 'Premises / rent' }),
    a('4110', 'expense', { it: 'Utenze (energia, acqua, gas)', en: 'Utilities' }),
    a('4200', 'expense', { it: 'Manutenzioni e attrezzature', en: 'Maintenance & equipment' }),
    a('4300', 'expense', { it: 'Assicurazioni', en: 'Insurance' }),
    a('4400', 'expense', { it: 'Spese amministrative', en: 'Administration' }),
    a('4500', 'expense', { it: 'Software e informatica', en: 'IT / software' }),
    a('4600', 'expense', { it: 'Pubblicità e marketing', en: 'Advertising & marketing' }),
    a('4620', 'expense', { it: 'Quote associative e federazioni', en: 'Federation fees' }),
    a('4900', 'expense', { it: 'Altri costi d’esercizio', en: 'Other operating expenses' }),
    a('4700', 'expense', { it: 'Commissioni di pagamento (Stripe/Payrexx)', en: 'Payment fees' }),
    a('4710', 'expense', { it: 'Commissioni piattaforma (Linyup)', en: 'Platform fees (Linyup)' }),
  ],
  mapping: {
    revenue_by_category: {
      membership: '3000',
      drop_in: '3001',
      course: '3002',
      product: '3003',
      other: '3009',
    },
    clearing_by_source: {
      connect: '1210',
      byo_stripe: '1211',
      payrexx: '1212',
      manual: '1000',
    },
    bank_account: '1200',
    stripe_fee_account: '4700',
    platform_fee_account: '4710',
    chargeback_account: '3100',
    retained_earnings_account: '2900',
  },
}

export const CHART_TEMPLATES: Record<ChartTemplateId, ChartTemplate> = {
  ch_kmu: CH_KMU,
  de_skr04: DE_SKR04,
  it_standard: IT_STANDARD,
}

/** Template default for a team country (ISO 3166-1 alpha-2). CH-first fallback. */
export function templateForCountry(country?: string | null): ChartTemplateId {
  switch ((country ?? '').trim().toUpperCase()) {
    case 'DE':
      return 'de_skr04'
    case 'IT':
      return 'it_standard'
    default:
      return 'ch_kmu'
  }
}

/** Resolve the seed name for an account in the team's locale (en fallback). */
export function resolveAccountName(account: ChartTemplateAccount, locale?: string | null): string {
  const l = (locale ?? 'en').slice(0, 2) as ChartLocale
  return account.names[l] ?? account.names.en ?? account.code
}
