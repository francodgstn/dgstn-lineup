# Creates Secret Manager secret CONTAINERS and grants the functions runtime SA
# read access. Secret VALUES are added out-of-band (gcloud secrets versions add)
# so plaintext never lands in Terraform state — there are deliberately no
# google_secret_manager_secret_version resources here.
#
# Secret IDs match the convention in packages/functions/src/utils/secrets.ts:
#   stripe-secret-key → env STRIPE_SECRET_KEY (hyphens→underscores, uppercased).

resource "google_secret_manager_secret" "secret" {
  for_each = toset(var.secret_ids)

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }
}

# Functions runtime SA may read every secret container.
resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = toset(var.secret_ids)

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.runtime_sa_email}"

  depends_on = [google_secret_manager_secret.secret]
}

# Admin console runtime SA may ADD new versions of specific secrets (it does not
# read them). The Settings UI writes the global SMTP password this way; code
# tracks a password_set flag in Firestore instead of reading the value back.
resource "google_secret_manager_secret_iam_member" "admin_version_adder" {
  for_each = toset(var.admin_writable_secret_ids)

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${var.admin_sa_email}"

  depends_on = [google_secret_manager_secret.secret]
}
