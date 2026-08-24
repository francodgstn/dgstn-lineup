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

# Vertex AI (in-app AI assistant): the functions runtime SA authenticates to
# Vertex via ADC — no API key. This is the only IAM the assistant needs.
resource "google_project_iam_member" "functions_runtime_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.functions_runtime.email}"
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

# ── Dedicated admin console (App Hosting) runtime SA ──────────────────────────
# The operator console (apps/admin) runs on its own App Hosting backend and needs
# MORE than the shared default firebase-app-hosting-compute SA used by apps/web:
# Firestore WRITE (Settings page) + write access to the smtp-password secret
# (granted in the secrets module). A dedicated SA keeps those elevated grants off
# the customer web app's identity. Point the admin backend at this SA — see the
# "Operator console" section in infra/README.md.
resource "google_service_account" "admin_runtime" {
  project      = var.project_id
  account_id   = "linyup-admin"
  display_name = "Linyup Admin Console Runtime"
  description  = "Runtime identity for the apps/admin App Hosting backend. Reads accounts/metrics, writes app_settings, sets the global SMTP password."
}

resource "google_project_iam_member" "admin_runtime_roles" {
  for_each = toset([
    "roles/firebaseapphosting.computeRunner",   # required for any App Hosting backend runtime SA
    "roles/firebase.sdkAdminServiceAgent",      # Firebase Admin SDK runtime operations
    "roles/developerconnect.readTokenAccessor", # pull source for the GitHub-connected build
    "roles/datastore.user",                     # read accounts/metrics + write app_settings/global_settings
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.admin_runtime.email}"
}

# Deploy SA must be able to act as the admin SA to assign it to the backend.
resource "google_service_account_iam_member" "deploy_acts_as_admin" {
  service_account_id = google_service_account.admin_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deploy_sa_email}"
}

# ── Custom-token signing (createCustomToken → IAM signBlob) ───────────────────
# A gen2 function holds no service-account private key, so the Admin SDK signs
# custom tokens by calling the IAM signBlob API as its own identity. That call
# needs roles/iam.serviceAccountTokenCreator ON ITSELF; roles/editor does not
# include the permission.
#
# Every contact session in the product is such a token — the census of callers
# is packages/functions/src/utils/contactSession.ts's buildContactSession — so
# without this grant passwordless contact login fails everywhere (web Space,
# public surfaces, mobile app) with auth/insufficient-permission. The failure is
# invisible to a deploy and to every test: it only appears when a real person
# tries to sign in, which is how it reached all three environments unnoticed
# (found in prod 2026-08-22, and in staging where it had been failing since at
# least 2026-08-17).
resource "google_service_account_iam_member" "functions_runtime_token_creator" {
  service_account_id = google_service_account.functions_runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.functions_runtime.email}"
}

# The SA the functions ACTUALLY run as today (the default compute SA). Kept as a
# list so this does not have to be reopened when the runtime identity changes.
resource "google_service_account_iam_member" "extra_token_creator" {
  for_each = toset(var.extra_token_creator_sa_emails)

  service_account_id = "projects/${var.project_id}/serviceAccounts/${each.value}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${each.value}"
}
