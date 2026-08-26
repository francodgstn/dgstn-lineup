# Firebase App Hosting backends — the Next.js web app and the operator console,
# each a Cloud Run-backed SSR backend. Until 2026-08-26 these were hand-created
# with the `apphosting:backends:create` CLI runbook and lived only in the Console;
# this module brings the backends under terraform so no environment needs a
# manual `backends:create`.
#
# THE GITHUB REPO CONNECTION IS NOT MANAGED HERE, deliberately, and cannot be:
# the backend API accepts a codebase repository ONLY when its Developer Connect
# connection was made with the FIREBASE GitHub app ("Only codebase repositories
# connected to the Firebase Github app are supported" — a 400 otherwise). That
# FIREBASE-app connection is minted exclusively by App Hosting's own "Connect
# repository" flow (Console / `backends:create`); a standalone Developer Connect
# connection is a DEVELOPER_CONNECT-app link and is rejected. So the connection
# is Console-managed and terraform stays out of the codebase entirely:
#
#   - var.repository UNSET (sandbox, prod): terraform creates the backend with NO
#     codebase — a valid, empty shell — and you connect the repo afterwards in
#     the App Hosting settings UI. `ignore_changes` then leaves that connection
#     alone forever, so a `terraform apply` never tears down a repo you wired by
#     hand.
#   - var.repository SET (staging, whose FIREBASE link predates this module):
#     terraform seeds the codebase at create/import to match the existing state;
#     `ignore_changes` still hands ongoing ownership to the Console from then on.
#
# The compute service account and its three roles
# (firebaseapphosting.computeRunner, firebase.sdkAdminServiceAgent,
# developerconnect.readTokenAccessor) are provisioned by the `iam` module, not
# here, so the account exists before a backend points at it.

resource "google_firebase_app_hosting_backend" "this" {
  for_each = var.backends

  project      = var.project_id
  location     = var.location
  backend_id   = each.key
  app_id       = var.app_id
  display_name = each.value.display_name

  # GLOBAL_ACCESS matches what the CLI create produced; the web tier serves
  # worldwide even though it runs in europe-west4.
  serving_locality = "GLOBAL_ACCESS"
  service_account  = each.value.service_account
  environment      = each.value.environment

  # Only rendered when a FIREBASE-app repo link is supplied (staging). Where it
  # is not (sandbox, prod), the backend is created bare and the repo is connected
  # in the Console. Either way `ignore_changes` below keeps the codebase
  # Console-owned.
  dynamic "codebase" {
    for_each = var.repository == null ? [] : [1]
    content {
      repository     = var.repository
      root_directory = each.value.root_directory
    }
  }

  lifecycle {
    ignore_changes = [codebase]
  }
}
