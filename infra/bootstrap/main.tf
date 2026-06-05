# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap stack — run ONCE, manually, by a human with Owner + billing rights.
#
# Solves the chicken-and-egg problem: it creates the two things every other
# Terraform apply depends on —
#   1. the GCS bucket that holds remote state for ALL stacks, and
#   2. the keyless Workload Identity Federation identity that GitHub Actions
#      uses to deploy (no JSON service-account key anywhere).
#
# First apply runs with LOCAL state (backend.tf is commented out). After the
# bucket exists, uncomment backend.tf and run `terraform init -migrate-state`.
# ─────────────────────────────────────────────────────────────────────────────

# ── Terraform state bucket (shared by all stacks, isolated via prefixes) ──────
resource "google_storage_bucket" "tf_state" {
  name                        = "linyup-tfstate-${var.org_suffix}"
  project                     = var.bootstrap_project_id
  location                    = var.state_bucket_location
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ── CI deploy service account (impersonated by GitHub Actions via WIF) ────────
resource "google_service_account" "ci_deploy" {
  project      = var.bootstrap_project_id
  account_id   = "linyup-ci-deploy"
  display_name = "Linyup GitHub Actions Deploy"
  description  = "Impersonated by GitHub Actions via Workload Identity Federation to run firebase deploy. Project-level roles are granted per-environment in modules/iam."
}

# ── Workload Identity Federation — keyless OIDC trust for GitHub Actions ──────
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.bootstrap_project_id
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions"
  description               = "Identity pool for GitHub Actions OIDC tokens"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.bootstrap_project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Security: only tokens from our repository may use this provider at all.
  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ── Allow the GitHub repo to impersonate the deploy SA via WIF ────────────────
# Scoped to the repository. Tighten to a specific branch/ref for prod later by
# switching to `attribute.ref/refs/heads/main` on a prod-only deploy SA.
resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.ci_deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
