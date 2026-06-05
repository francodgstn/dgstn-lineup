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
  for_each = google_secret_manager_secret.secret

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.runtime_sa_email}"
}
