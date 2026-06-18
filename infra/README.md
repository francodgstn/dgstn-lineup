# Linyup Infrastructure as Code

Terraform that provisions the Firebase/GCP plumbing for Linyup's **staging** and
**production** environments, plus keyless CI deploys via Workload Identity
Federation (WIF).

> **Local development needs none of this.** Day-to-day work uses the Firebase
> emulators against the `demo-linyup` project (see the root `CLAUDE.md`). This
> directory is only for standing up real cloud environments.

---

## Ownership boundary — what Terraform owns vs the Firebase CLI

Two tools touch the same project, so the split is deliberate and
non-overlapping. Rule of thumb: **Terraform creates the empty box; the Firebase
CLI fills it.**

| Terraform owns (slow-moving plumbing) | Firebase CLI owns (fast-moving, repo-versioned) |
|---|---|
| Project creation + billing link | Functions **code** (`firebase deploy --only functions`) |
| API/service enablement | Firestore **rules + indexes** (`firestore.rules`, `firestore.index.json`) |
| Service accounts + IAM | Hosting **content** (`apps/web/.next`, `apps/landing/dist`) |
| Secret Manager **containers** (no values) | Storage **rules** (`storage.rules`) |
| Firestore **database instance** (not rules/indexes) | Realtime DB **rules** (deny-all, unused) |
| Firebase project init + Web App + Hosting **sites** | **Cloud Tasks queue** `executeDelayedRule` (auto-created on deploy) |
| App Hosting API + deploy SA role (`roles/firebaseapphosting.admin`) | App Hosting **backend** creation (CLI, once) + GitHub repo connection (Console, once) |
| WIF pool/provider + CI deploy SA | |
| Budgets/alerts + TF state bucket | |

The Cloud Tasks queue is **not** in Terraform:
`packages/functions/src/automation/executeDelayedRule.ts` is an
`onTaskDispatched` handler, and Firebase auto-provisions its queue on deploy.

---

## Layout

```
infra/
├── bootstrap/            # run ONCE: TF state bucket + WIF + CI deploy SA (local→GCS state)
├── modules/
│   ├── project-services/ # API enablement
│   ├── firebase-project/ # firebase project + web app + hosting sites (google-beta)
│   ├── firestore/        # database instance only (location LOCKED to europe-west6)
│   ├── secrets/          # secret containers + accessor IAM (no values)
│   ├── iam/              # functions runtime SA + deploy SA project roles
│   └── budget/           # billing budget + alerts
└── environments/
    ├── staging/          # wires modules for linyup-staging  (state prefix env/staging)
    └── prod/             # wires modules for linyup-prod      (state prefix env/prod)
```

State lives in **one GCS bucket** with per-stack prefixes (`bootstrap`,
`env/staging`, `env/prod`).

---

## Prerequisites

- Terraform >= 1.7, `gcloud`, and the GitHub CLI (`gh`).
- A **billing account** ID (`gcloud billing accounts list`).
- A bootstrap/admin project (e.g. `linyup-admin`) created by hand once.

### Organization?

A GCP **Organization** is optional and only exists if you use Google Workspace
or Cloud Identity on a domain. A **personal Google account has no org**
(`gcloud organizations list` returns empty) — that is the assumed setup here:

- Leave `org_id` and `folder_id` **unset** in `terraform.tfvars`; projects are
  created under "No organization".
- The operator who runs the bootstrap/apply just needs to be able to create
  projects (default for the account that owns billing) and `roles/billing.user`
  on the billing account. There is no org-level IAM to grant.
- Note the per-account **project-creation quota** is low (~12–30); fine for a
  two-project SaaS. For production hardening, consider a free Cloud Identity org
  on `linyup.com` later so ownership isn't tied to a personal Gmail — then set
  `org_id` and re-apply.

---

## Runbook

### 1. Bootstrap (once, by a human, local state)

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars   # fill in bootstrap_project_id, org_suffix
gcloud auth application-default login          # as a principal with the perms above
terraform init                                 # backend.tf is commented → local state
terraform apply
```

Then migrate bootstrap state into the new bucket:

```bash
# Uncomment backend.tf and set bucket = <tf_state_bucket output>
terraform init -migrate-state
```

Record the outputs — you'll need them everywhere:

```bash
terraform output            # tf_state_bucket, wif_provider, ci_deploy_sa_email
```

### 2. Per-environment apply (staging shown; repeat for prod)

```bash
cd infra/environments/staging
# Edit backend.tf: set bucket = <tf_state_bucket>
cp terraform.tfvars.example terraform.tfvars   # project_id, billing_account, deploy_sa_email
terraform init
terraform plan
terraform apply
```

If the first apply fails on a Firebase/Firestore resource right after the APIs
were enabled (enablement is async), just **re-run apply**, or target services
first: `terraform apply -target=module.services` then a full apply.

### 3. Populate secret values (out-of-band, per env)

Terraform creates empty secret containers; values are added with `gcloud` so
plaintext never enters Terraform state:

```bash
echo -n "<value>" | gcloud secrets versions add stripe-secret-key     --project=linyup-staging --data-file=-
echo -n "<value>" | gcloud secrets versions add stripe-webhook-secret --project=linyup-staging --data-file=-
echo -n "<value>" | gcloud secrets versions add smtp-password         --project=linyup-staging --data-file=-
echo -n "<value>" | gcloud secrets versions add posthog-api-key       --project=linyup-staging --data-file=-
```

Secret IDs follow the convention in `packages/functions/src/utils/secrets.ts`:
`stripe-secret-key` → runtime env `STRIPE_SECRET_KEY` (hyphens→underscores,
uppercased). **Rotation** = add a new version with the same command.

### 4. Wire up GitHub (once)

```bash
# From the bootstrap outputs:
gh secret set GCP_WIF_PROVIDER --body "$(cd infra/bootstrap && terraform output -raw wif_provider)"
gh secret set GCP_DEPLOY_SA    --body "$(cd infra/bootstrap && terraform output -raw ci_deploy_sa_email)"
# Production may reuse the same SA, or set a dedicated one:
gh secret set GCP_PROD_DEPLOY_SA --body "<prod deploy SA email>"

# Public Firebase config → GitHub Actions VARIABLES (not secrets):
cd infra/environments/staging
gh variable set STAGING_FIREBASE_API_KEY     --body "$(terraform output -json firebase_web_config | jq -r .api_key)"
gh variable set STAGING_MESSAGING_SENDER_ID  --body "$(terraform output -json firebase_web_config | jq -r .messaging_sender_id)"
gh variable set STAGING_APP_ID               --body "$(terraform output -json firebase_web_config | jq -r .app_id)"
# Repeat with PROD_* from infra/environments/prod for production.
```

### 5. Confirm hosting targets (Firebase CLI, once)

The site IDs Terraform created must match `.firebaserc`. Apply the target map:

```bash
firebase target:apply hosting app     linyup-staging         --project staging
firebase target:apply hosting landing linyup-staging-landing --project staging
```


### 5b. Set up Firebase App Hosting backend (once, per env)

The Next.js web app runs on **Firebase App Hosting** (Cloud Run-backed SSR),
not Firebase Hosting (static). A backend must be created once per environment.

#### Create the backend via CLI

```bash
# Staging -- firebaseapphosting.googleapis.com must be enabled first (terraform apply)
npx firebase-tools apphosting:backends:create \\
  --project linyup-staging \\
  --app 1:157648925506:web:5e3aa70930d777f8374edb \\
  --backend linyup-web \\
  --primary-region us-central1 \\
  --root-dir apps/web \\
  --non-interactive
```

> **Note:** App Hosting is not available in europe-west6. Use us-central1.

#### Connect the GitHub repo (Firebase Console -- one-time manual step)

1. Go to **Firebase Console** -> select linyup-staging -> **App Hosting**
2. Click the linyup-web backend -> **Connect repository**
3. Authorize the Firebase GitHub App and select **francodgstn/dgstn-linyup**
4. Set **Branch**: main, **Root directory**: apps/web

Once connected, every push to main **auto-deploys** the web app -- no CI step required.
The apps/web/apphosting.yaml file controls the Cloud Run instance (CPU, memory, scaling, env vars).

#### Grant the App Hosting backend access to secrets

```bash
npx firebase-tools apphosting:secrets:grantaccess firebase-api-key \\
  --project linyup-staging --backend linyup-web
```

### 5c. Operator console — apps/admin App Hosting backend (once, per env)

The internal **operator console** (`apps/admin`, `@linyup/admin`) is a SEPARATE
App Hosting backend in the same project, on its own domain (e.g. `ops.linyup.com`).
Unlike `apps/web`, it **writes** Firestore (`app_settings/global_settings` via the
Settings page) and **writes** the `smtp-password` secret, so it must run as the
**dedicated `linyup-admin` service account** — created with all its IAM by
Terraform — instead of the shared `firebase-app-hosting-compute` SA. This keeps
those elevated grants off the customer web app's identity.

```bash
# The SA + its roles already exist after `terraform apply`:
terraform output -raw admin_runtime_sa
#   → linyup-admin@<project>.iam.gserviceaccount.com

# Create the backend (root-dir apps/admin). Set its runtime SA to linyup-admin:
npx firebase-tools apphosting:backends:create \
  --project linyup-staging \
  --app <WEB_APP_ID> \
  --backend linyup-admin \
  --primary-region us-central1 \
  --root-dir apps/admin \
  --service-account "$(terraform output -raw admin_runtime_sa)" \
  --non-interactive
```

> If your firebase-tools version has no `--service-account` flag, create the
> backend normally, then set the service account in **Firebase Console → App
> Hosting → linyup-admin → ⚙ Settings → Service account → `linyup-admin@…`**.

Then connect the GitHub repo (Console, root directory `apps/admin`, branch `main`)
exactly as for `linyup-web` above. The `OPERATOR_EMAILS` + public
`NEXT_PUBLIC_FIREBASE_*` config are already set in `apps/admin/apphosting.yaml`
(staging) and `apphosting.prod.yaml` (prod) — for a prod backend, set its
**Environment name** to `prod` (Console → App Hosting → backend → settings) so the
prod overrides apply, mirroring `apps/web`.

**No `apphosting:secrets:grantaccess` is needed** for the SMTP password — Terraform
already grants `linyup-admin` `secretVersionAdder` on `smtp-password` (write). The
console never reads the value back (it tracks a `password_set` flag in Firestore).

### 6. Enable CI

**Staging — auto from `main`.** Merge to `main` → `.github/workflows/deploy.yml`
runs a keyless deploy of functions/rules/landing, and the **staging** App Hosting
backends (web + admin) auto-roll out from `main` via their GitHub connection. Fast
feedback; no gate.

**Production — one gated release, everything in lockstep.** `deploy-prod.yml`
(manual `workflow_dispatch` or a `v*` tag, gated on the `production` GitHub
environment's required reviewer) deploys functions/rules/landing **and** triggers
the App Hosting rollout for web + admin (`apphosting:rollouts:create … --git-commit
$GITHUB_SHA`). So the prod web app can never ship ahead of the backend it calls.

> **Prerequisite — disable auto-rollout on the PROD App Hosting backends.** For
> the gate to mean anything, the prod `linyup-web` and `linyup-admin` backends
> must NOT auto-deploy on push. In **Console → App Hosting → backend → ⚙ Settings →
> Deployment / rollouts**, turn **automatic rollouts off** (leave the GitHub repo
> connected — manual rollouts still build from it). Leave staging backends on
> auto-rollout. The prod deploy SA already has `firebaseapphosting.admin`, so the
> workflow can create rollouts.

---

## Sandbox environment (demo playground)

`linyup-sandbox` is a throwaway environment that powers the public `/try` page:
six fully-seeded **Studio** demo tenants (sport + wellness) with one-click logins.
It uses the same modules as staging — only `project_id`, hosting site IDs and the
budget differ — plus two demo-specific switches.

```bash
# 1. Provision the project (same flow as staging)
cd infra/environments/sandbox
# backend.tf already points at prefix env/sandbox; tfvars set project_id=linyup-sandbox
terraform init
terraform apply        # re-run if Firebase resources fail once (async API enablement)

# 1b. Provision the default Storage bucket (one-time; Terraform enables the API
#     but the bucket itself is the Console "Get started" step — without it,
#     `deploy --only storage` fails with "Firebase Storage has not been set up").
#     Console: Storage → Get Started, or via API:
curl -X POST "https://firebasestorage.googleapis.com/v1beta/projects/linyup-sandbox/defaultBucket" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" -H "X-Goog-User-Project: linyup-sandbox" \
  -d '{"location":"europe-west6"}'

# 1c. Deploy backend rules/indexes/functions (first time — afterwards this is
#     automated by .github/workflows/deploy-sandbox.yml on push to main). A fresh
#     Firestore DB ships locked (deny-all), so the client sees nothing until the
#     repo rules are deployed:
firebase deploy --only firestore,storage,functions --project sandbox

# 2. Secrets (same IDs as staging; demo can reuse test Stripe/SMTP keys)
echo -n "<value>" | gcloud secrets versions add stripe-secret-key --project=linyup-sandbox --data-file=-
#   …repeat for stripe-webhook-secret, smtp-password, smtp-encryption-key, posthog-api-key

# 3. Hosting targets (must match .firebaserc)
firebase target:apply hosting app     linyup-sandbox         --project sandbox
firebase target:apply hosting landing linyup-sandbox-landing --project sandbox

# 4. App Hosting backend. Fill apphosting.sandbox.yaml's REPLACE_WITH_* values
#    (and pass the web app id to --app) from:
cd infra/environments/sandbox && terraform output -json firebase_web_config
#    NOTE: firebase-tools has no --environment flag on create; set the backend's
#    "Environment name" to `sandbox` afterwards in the Console (App Hosting →
#    linyup-web → ⚙ Settings → Environment name) so apphosting.sandbox.yaml
#    applies (NEXT_PUBLIC_DEMO_MODE=true + sandbox Firebase config).
npx firebase-tools apphosting:backends:create \
  --project linyup-sandbox --app <WEB_APP_ID> --backend linyup-web \
  --primary-region us-central1 --root-dir apps/web --non-interactive

# 5. Seed the six demo Studio tenants (ADC; idempotent — reset:sandbox to wipe first)
pnpm seed:sandbox

# 6. Custom domain — the public demo lives at https://demo.linyup.com/try.
#    a) Firebase Console → App Hosting → linyup-web (sandbox) → Custom domains →
#       add `demo.linyup.com`; set the DNS records it prints at the registrar.
#    b) Firebase Console → Authentication → Settings → Authorized domains →
#       add `demo.linyup.com` (required even for email/password sign-in).
```

The demo MUST be served from this sandbox deployment (it's built against the
`linyup-sandbox` Firebase project). It cannot live under `linyup.com/try` — that
build targets `linyup-prod`, where the demo accounts/data don't exist, and `/try`
404s there by design (`NEXT_PUBLIC_DEMO_MODE` is unset on prod).

Demo logins (all `linyup123`, plan `studio`/`active`): `grappling@`, `crossfit@`,
`tennis@`, `yoga@`, `pilates@`, `dance@` `linyup.com`.

> **Auto-reseed** (nightly wipe + reseed) is a deferred follow-up — for now reseed
> manually with `pnpm reset:sandbox` then `pnpm seed:sandbox`.

---

## How to…

- **Add a secret** → add the ID to `secret_ids` in the env stack (or the module
  default), `terraform apply`, then `gcloud secrets versions add` the value. Use
  it in code via `getSecret('my-secret')`.
- **Add a Firestore index** → edit `firestore.index.json` and deploy with the
  Firebase CLI. **Not** Terraform.
- **Add a Cloud Tasks queue** → write an `onTaskDispatched` function; Firebase
  creates the queue on deploy. **Not** Terraform.

---

## Gotchas

- Every `google_firebase_*` resource uses the **google-beta** provider.
- **App Hosting region** is immutable after backend creation. europe-west6 is unsupported -- use us-central1. The firebaseapphosting.googleapis.com API must be enabled (via terraform apply) before creating the backend.
- **App Hosting vs Hosting**: apps/landing uses Firebase Hosting (static, deployed by CI); apps/web uses App Hosting (SSR, auto-deployed via GitHub integration on push to main).
- Firestore **location is immutable** — `europe-west6` is locked on first apply
  (`prevent_destroy` + `deletion_policy = ABANDON`). Choose deliberately.
- API enablement is **async** — re-run apply if Firebase resources fail once.
- Hosting `site_id`s must equal `.firebaserc` exactly (`linyup-staging`,
  `linyup-staging-landing`, `linyup-prod`, `linyup-prod-landing`).
- The deploy SA needs `iam.serviceAccountUser` **on the runtime SA** (granted in
  `modules/iam`) or gen2 function deploys fail with an `actAs` error.
- `id-token: write` permission is mandatory in the deploy workflows for WIF.
- **Never** put secret values in Terraform — containers only.

---

## Disaster recovery

- The state bucket has **object versioning** enabled; a corrupted/lost state can
  be restored from a prior generation.
- `prevent_destroy` guards the project, Firestore DB, and state bucket against
  accidental `terraform destroy`.
- Re-creating an environment from scratch = re-run the per-environment apply
  against a fresh project ID, then re-populate secrets and re-deploy via CI.
