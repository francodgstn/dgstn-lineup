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
- A GCP **Organization** (or folder) and a **billing account** ID.
- A bootstrap/admin project (e.g. `linyup-admin`) created by hand once.
- The bootstrap operator needs, at the org/folder level:
  `roles/resourcemanager.projectCreator`, `roles/billing.user`, and Owner on the
  bootstrap project.

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
cp terraform.tfvars.example terraform.tfvars   # project_id, billing_account, org_id, deploy_sa_email
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

### 6. Enable CI

Merge to `main` → `.github/workflows/deploy.yml` runs a keyless deploy. Production
deploys run via `.github/workflows/deploy-prod.yml` (manual `workflow_dispatch`
or a `v*` tag), gated on the `production` GitHub environment's required reviewer.

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
