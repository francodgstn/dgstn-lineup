# ─────────────────────────────────────────────────────────────────────────────
# Sandbox environment — the public demo playground (linyup-sandbox).
# Identical module wiring to staging; only project_id / site ids / budget differ.
# The web app is seeded with throwaway demo Club tenants (scripts/seed-sandbox.ts)
# and serves the public /try page (NEXT_PUBLIC_DEMO_MODE=true via
# apps/web/apphosting.sandbox.yaml).
# ─────────────────────────────────────────────────────────────────────────────

locals {
  # APIs required by the Linyup stack. Gen2 functions specifically need
  # run + cloudbuild + artifactregistry + eventarc + pubsub.
  apis = [
    "firebase.googleapis.com",
    "firebaserules.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaseapphosting.googleapis.com",
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudtasks.googleapis.com",
    "identitytoolkit.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "serviceusage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "billingbudgets.googleapis.com",
    "aiplatform.googleapis.com", # Vertex AI — in-app assistant
  ]
}

# ── Project (created by Terraform, or referenced if create_project = false) ───
resource "google_project" "this" {
  count = var.create_project ? 1 : 0

  name            = var.project_id
  project_id      = var.project_id
  billing_account = var.billing_account
  org_id          = var.org_id
  folder_id       = var.folder_id

  # Firestore/App Engine location lock — never let Terraform tear the project down.
  lifecycle {
    prevent_destroy = true
  }
}

data "google_project" "this" {
  count      = var.create_project ? 0 : 1
  project_id = var.project_id
}

locals {
  project_number = var.create_project ? google_project.this[0].number : data.google_project.this[0].number
}

# ── API enablement ────────────────────────────────────────────────────────────
module "services" {
  source     = "../../modules/project-services"
  project_id = var.project_id
  apis       = local.apis

  depends_on = [google_project.this]
}

# ── Firebase init + web app + hosting sites ───────────────────────────────────
module "firebase" {
  source          = "../../modules/firebase-project"
  project_id      = var.project_id
  env             = "sandbox"
  app_site_id     = var.app_site_id
  landing_site_id = var.landing_site_id

  depends_on = [module.services]
}

# ── Firestore database instance ───────────────────────────────────────────────
module "firestore" {
  source             = "../../modules/firestore"
  project_id         = var.project_id
  firestore_location = var.firestore_location

  depends_on = [module.services]
}

# ── Firebase Storage default bucket ───────────────────────────────────────────
module "storage" {
  source           = "../../modules/storage"
  project_id       = var.project_id
  storage_location = var.storage_location

  depends_on = [module.services]
}

# ── IAM: runtime SA + deploy SA roles ─────────────────────────────────────────
module "iam" {
  source          = "../../modules/iam"
  project_id      = var.project_id
  deploy_sa_email = var.deploy_sa_email

  depends_on = [module.services]
}

# ── Secret containers + accessor IAM ──────────────────────────────────────────
module "secrets" {
  source           = "../../modules/secrets"
  project_id       = var.project_id
  secret_ids       = var.secret_ids
  runtime_sa_email = module.iam.functions_runtime_email
  admin_sa_email   = module.iam.admin_runtime_email

  admin_writable_secret_ids = var.admin_writable_secret_ids

  depends_on = [module.services]
}

# ── Billing budget + alerts ───────────────────────────────────────────────────
module "budget" {
  source          = "../../modules/budget"
  billing_account = var.billing_account
  project_number  = local.project_number
  env             = "sandbox"
  budget_amount   = var.budget_amount

  depends_on = [module.services]
}
