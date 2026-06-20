# Mail (Brevo)

All application mail is sent through Brevo's HTTP **transactional email API**. There
is no SMTP and there are **no stored mail credentials** for anyone — the Brevo API
key is server-side only and BYO domains are authenticated via the studio's own DNS.

## Layout

| File | Responsibility |
|---|---|
| `types.ts` | Provider-agnostic contracts (`OutboundMessage`, `ResolvedSender`, `MailProvider`). |
| `mailService.ts` | The single entry point. `sendSystemMail` / `sendStudioMail`; test-mode redirect, suppression, idempotency, retry. |
| `senderResolution.ts` | **Pure** resolution of the sender identity (Managed vs verified BYO). Unit-tested. |
| `senderIdentity.ts` | System + Managed-studio identities, env-backed (the deferrable-subdomain seam). |
| `senderConfig.ts` | Firestore read/write of `EmailSenderConfig`, team contact-email + studio context. |
| `suppression.ts` | Suppression list read/write (`mail_suppressions`). |
| `brevoProvider.ts` | The Brevo adapter — the **only** file that sends via the Brevo SDK. |
| `brevoClient.ts` | Shared `BrevoClient` (API key from Secret Manager). |
| `brevoDomains.ts` | Brevo sender-domains API (create / status / authenticate / delete). |
| `domainAuth.ts` | Callables: `registerSenderDomain`, `checkSenderDomain`, `useManagedSender`. |
| `handleBrevoWebhook.ts` | `onRequest` webhook → suppression + delivery-status ledger. |

Application code does **not** import this module directly — it calls
`sendEmail(...)` from `../utils/email`, a thin façade. Pass `teamId` to send **as the
studio**; omit it to send **Linyup system mail**.

## Sender resolution (`sendStudioMail`)

1. **Managed** (default, everyone): from the Managed linyup.com address, display name =
   the studio's name, Reply-To = the studio's contact email.
2. **BYO domain** (opt-in, paid plans only): once the studio's domain is `verified` in
   Brevo, mail is sent from `<local-part>@<their-domain>` (local part chosen by the
   studio, default `info`). Until verified — or if verification breaks, or the plan is
   free — it automatically falls back to Managed. An unauthenticated third-party domain
   is never put in the From.

System mail always sends from the configured system identity (`hello@linyup.com`),
kept separate from studio mail so the two streams can later move to separate
subdomains for reputation isolation.

## Environment

**Secrets** (Secret Manager in prod; `packages/functions/.env.local` for the emulator,
gitignored):

| Name | Secret Manager | Emulator env |
|---|---|---|
| Brevo API key | `brevo-api-key` | `BREVO_API_KEY` |
| Webhook shared token | `brevo-webhook-secret` | `BREVO_WEBHOOK_SECRET` |

**Non-secret params** (`firebase-functions/params`, overridable per environment;
defaults shown):

| Param | Default | Meaning |
|---|---|---|
| `MAIL_SYSTEM_FROM` | `hello@linyup.com` | System mail From |
| `MAIL_SYSTEM_NAME` | `Linyup` | System mail display name |
| `MAIL_MANAGED_STUDIO_FROM` | `studios@linyup.com` | Managed studio mail From (display name = studio) |
| `TEST_MODE` | `false` | Redirect all mail to `TEST_EMAIL` |
| `TEST_EMAIL` | — | Recipient when `TEST_MODE=true` |

## Brevo account setup (one-time)

1. **Authenticate `linyup.com`** in Brevo (Senders & IP → Domains): add the DKIM +
   Brevo-code records. Create/verify the senders `hello@linyup.com` and
   `studios@linyup.com`.
2. Create a **restricted** API key (transactional email + domains scopes) → store as
   the `brevo-api-key` secret. Never expose it to the client or logs.
3. Create a transactional **event webhook** pointing at the deployed handler with the
   shared token in the query string:
   `https://<region>-<project>.cloudfunctions.net/handleBrevoWebhook?token=<brevo-webhook-secret>`
   Subscribe to: `delivered`, `hardBounce`, `softBounce`, `blocked`, `spam`,
   `invalid`/`invalid_email`, `unsubscribed`.

## BYO domain flow

`registerSenderDomain` → Brevo `POST /senders/domains` → persists `pending` config +
returns the DNS records to display. The studio adds the records; `checkSenderDomain`
polls Brevo (`authenticate` + `getDomainConfiguration`) and flips the status to
`verified`. `useManagedSender` reverts to Managed and removes the Brevo domain.

## Suppression & idempotency

- The webhook writes a `mail_suppressions/{sha256(email)}` doc on
  hardBounce/blocked/spam/invalid/unsubscribed; `mailService` skips suppressed
  recipients so repeated sends to dead addresses stop.
- Pass `idempotencyKey` on critical-path sends. The key is forwarded to Brevo
  (`Idempotency-Key` header) and recorded in `mail_sends/{key}`; a duplicate keyed
  send is skipped, and keyed sends are retried with backoff (safe because Brevo
  dedupes on the key).

## Tests

- `senderResolution.test.ts` — Managed / BYO-verified / BYO-unverified→fallback /
  no-domain→Managed / free-plan→Managed.
- `brevoProvider.test.ts` — request mapping (sender, reply-to, idempotency, attachments).
- `handleBrevoWebhook.test.ts` — event classification.
- `brevo.integration.test.ts` — live, runs only when `BREVO_API_KEY` (and
  `BREVO_TEST_RECIPIENT` for sends) is set; covers system, managed-studio and BYO sends
  plus a domain-status read.
