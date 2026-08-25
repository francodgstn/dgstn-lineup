# Input pack for the ToS + DPA — facts, extracted from the code

This exists so a lawyer drafting Linyup's **Terms of Service** and **Data
Processing Agreement** does not have to bill for discovery. Everything below was
read out of the source, not out of the privacy policy — where the two disagree,
the code is what actually happens and the policy is what needs correcting.

**Status: NOT LEGAL ADVICE, and nothing here is binding text.** This is a
factual annexe. The drafting is Track A's external step.

Verified against `main` at `61b963a6`, 2026-08-25.

---

## 1. The parties, and who is what

| | |
|---|---|
| **Provider** | Franco D'Agostino, trading as "D'Agostino Production", Kleinhüningerstrasse 205, 4057 Basel, Switzerland. Not in the commercial register. "Linyup" is the product name, not a legal entity. (`apps/landing/src/pages/legal.md`) |
| **Customer** | A studio / coach / club — a business, never a consumer. The product has no consumer tier. |
| **Roles** | For the Customer's own **contacts** (members, students, clients), the **Customer is controller and Linyup is processor**. For the Customer's own account data (the person who signs up), Linyup is controller. This split is already stated at `privacy.md` §2.9 and is correct. |

The DPA is the processor half of that split. It is what `privacy.md` promises
twice and what does not exist.

---

## 2. Data categories Linyup processes on the Customer's behalf

Extracted from `packages/shared/src/types/contact.ts` and the booking rails.

- **Identity**: first name, last name, email, phone, date of birth, postal
  address (four-part map), photo.
- **Relationship**: acquisition source, affiliation status, subscription type
  and status, join date, group membership, notes written by the studio.
- **Activity**: bookings, attendance / check-ins, waitlist entries, appointment
  history, course purchases and entitlements.
- **Money**: payment line items, refunds, gift cards, credit packs, promo
  redemptions. **Card details are never stored** — they are entered directly
  with Stripe; Linyup receives status, amount and a reference.
- **Customer-defined**: arbitrary **custom fields** the studio configures. Linyup
  cannot enumerate these in advance, which matters for the DPA's data-categories
  annexe — it should describe the category as open-ended and put the choice of
  what to collect on the Customer, consistent with §2.9.
- **Signed documents**: waiver acceptances, with the frozen document version, the
  acceptance timestamp, and a self-declared minor/guardian flag.
- **Special-category risk**: nothing is collected as health data by design, but a
  studio can plainly type one into a note or a custom field. Worth an explicit
  clause telling the Customer not to, rather than silence.

---

## 3. Sub-processors

`privacy.md` §2.4 already carries this table and it is accurate, with **one
correction**:

| Sub-processor | Purpose | Location |
|---|---|---|
| Google Cloud / Firebase | Hosting, database, file storage, serverless functions | `europe-west6` (Zurich, CH) |
| Brevo (Sendinblue SAS) | Transactional email **and SMS** | France (EU) |
| PostHog, Inc. | Product analytics (session recording off) | EU region (Frankfurt); provider US-based |
| Stripe Payments Europe, Ltd. | Payment processing | Ireland (EU), group processing in the US |

**Correction owed:** the table says Brevo is "Transactional and marketing email".
`packages/functions/src/mail/smsService.ts` routes **SMS through Brevo too**
(`brevoSmsProvider`), so member **phone numbers** reach it. Fix the policy line
in the same pass as the DPA.

Application data stays in Switzerland (`europe-west6`). Transfers outside CH/EEA
are covered by SCCs / DPF per §2.4 — the DPA should name the same mechanism.

---

## 4. Retention and deletion — as implemented, not as promised

| What | Rule | Where |
|---|---|---|
| Contact self-deletion | **30-day** grace, then anonymisation | `CONTACT_DELETION_GRACE_DAYS`, `shared/utils/contactDeletion.ts:32`; actor is `dailyTasks/anonymizeScheduledContacts.ts` |
| Studio account deletion | **30-day** reversible window, then purge | `TEAM_DELETION_GRACE_DAYS`, `functions/src/teams/deleteAccount.ts:50`; actor is `dailyTasks/purgeScheduledTeams.ts` |
| Unverified signups | Hard-deleted after **7 days** | `UNVERIFIED_MAX_AGE_DAYS`, `dailyTasks/purgeUnverifiedSignups.ts:43` |
| Provisional contacts | Hard-deleted nightly once expired | `dailyTasks/purgeProvisionalContacts.ts` |
| Verification codes | Purged nightly | `dailyTasks/purgeVerificationCodes.ts` |
| Website logs | 30 days (Google Cloud default) | `privacy.md` §2.5 |

**Known gap the DPA must not overstate:** `purgeTeam` leaves the studio's Stripe
Connect account live. Recorded as accepted in `readiness-2026-08.md`. A
return/deletion clause that claims total erasure would be inaccurate today.

---

## 5. Return and portability — the weakest area

A DPA normally commits the processor to return the controller's data on
termination. What exists:

- **Finance/report CSV export** — `functions/src/finance/exportReport.ts`, plus
  CSV on the payments and custom-forms surfaces.
- **No contacts export.** There is no CSV or JSON export of the contact book from
  the contacts page. A studio leaving today cannot self-serve its own roster.
- Migration tooling (`scripts/migration/`) exists but is operator-run, one
  direction, and HMD-specific.

**Recommendation:** either build a contacts export before signing a DPA that
promises return-on-termination, or word the clause as "on written request, within
N days, in a commonly used machine-readable format" and be prepared to run it by
hand. The second is honest and cheap; the first is better product anyway.

---

## 6. Security measures (Art. 32 annexe input)

- Tenant isolation enforced in `firestore.rules` by `teamId`, not in application
  code; public surfaces read only world-readable `public_profile` mirrors.
- Secrets in Google Secret Manager (`brevo-api-key`, Stripe keys); **no stored
  mail credentials**, no SMTP.
- Passwordless contact sessions are short-lived custom tokens with claims checked
  in rules, not in the UI.
- Rate limiting on every public callable, per-surface.
- PITR enabled. **A restore has never been rehearsed** — `readiness-2026-08.md`
  lists this as still open. Do not let the DPA imply a tested RTO/RPO.
- App Check: partial. See `docs/app-check-rollout.md`.

---

## 7. Sub-processor change notification

Nothing in the product notifies Customers when a sub-processor changes. If the
DPA promises notice (most do), that is an operational commitment with no
mechanism behind it yet — either add a simple notification path or word the
clause as notice by email to the account owner, which is achievable today.

---

## 8. Open questions for the lawyer

1. **Governing law and forum** — Swiss (Basel) presumably, but the Customer base
   is Swiss-and-EU, so the DPA needs to satisfy GDPR Art. 28 as well as FADP.
2. **Which contracts exist**: one ToS with the DPA as an annexe, or two documents?
   The numbering already assumes a set (`legal.md` is "1.", `privacy.md` is "2.",
   and `privacy.md:14` cross-references a **"Section 9" that does not exist**).
   Whatever is drafted must resolve that dangling reference.
3. **Acceptance mechanics** — click-wrap at signup is what Track B builds. Confirm
   that is sufficient for formation under Swiss law for a B2B contract, and what
   the record must contain (identity, timestamp, version, IP?).
4. **Liability cap and SLA** — there is no SLA today, and no uptime commitment
   anywhere in the product or docs. Silence is a choice; make it a deliberate one.
5. **Payments** — the Customer contracts with Stripe directly via Connect for
   member payments. The ToS should be clear that Linyup is not the merchant of
   record for those, only for its own subscription fees.
