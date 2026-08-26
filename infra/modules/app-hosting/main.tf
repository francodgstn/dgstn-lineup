# Firebase App Hosting backends — the Next.js web app and the operator console,
# each a Cloud Run-backed SSR backend. Until 2026-08-26 these were hand-created
# with the `apphosting:backends:create` CLI runbook and lived only in the Console;
# this module brings them under terraform so no environment needs a manual create.
#
# SCOPE IS THE BACKENDS ONLY, deliberately (see the `repository` variable): the
# Developer Connect connection + git link that Firebase created with its own
# GitHub App do not import cleanly into terraform, and are a set-once per-project
# artifact — so they stay Console-managed and this module references the link by
# name.
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

  codebase {
    repository     = var.repository
    root_directory = each.value.root_directory
  }
}
