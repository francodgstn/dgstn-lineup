# Per-environment IAM:
#   - a dedicated Functions v2 runtime service account (preferred over the
#     default compute SA), and
#   - the project-level roles the CI deploy SA needs to run `firebase deploy`.
#
# The deploy SA itself is created in the bootstrap stack; here we grant it the
# roles it needs *on this environment's project*.

# ── Dedicated functions runtime SA ────────────────────────────────────────────
resource "google_service_account" "functions_runtime" {
  project      = var.project_id
  account_id   = "linyup-functions"
  display_name = "Linyup Functions Runtime"
  description  = "Runtime identity for Cloud Functions v2 (gen2). Reads Secret Manager secrets."
}

# ── Deploy SA: project-level roles for firebase deploy ────────────────────────
resource "google_project_iam_member" "deploy_roles" {
  for_each = toset(var.deploy_sa_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${var.deploy_sa_email}"
}

# ── Deploy SA: actAs on the runtime SA ────────────────────────────────────────
# Required so the deploy SA can deploy gen2 functions that run as the runtime SA,
# otherwise deploys fail with an actAs / iam.serviceAccounts.actAs error.
resource "google_service_account_iam_member" "deploy_acts_as_runtime" {
  service_account_id = google_service_account.functions_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deploy_sa_email}"
}
