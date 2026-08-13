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

# Admin console runtime SA may ADD new versions of the secrets it manages.
resource "google_secret_manager_secret_iam_member" "admin_version_adder" {
  for_each = toset(var.admin_writable_secret_ids)

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${var.admin_sa_email}"

  depends_on = [google_secret_manager_secret.secret]
}

# ...and READ them back. Write-only was the original design (the SMTP password
# tracked a password_set flag in Firestore instead), but the Brevo and Stripe
# settings pages report status via secretExists(), a real Secret Manager read,
# and their "send test email" / Stripe test actions call getSecretValue() for the
# live key. Without this the console still SAVED correctly but every status read
# hit PERMISSION_DENIED, which secret-manager.ts swallows into `false` — so the
# UI said "saved" and then showed "not configured", in every environment.
#
# This grants PLAINTEXT read of these keys to the console's runtime SA. That is
# inherent to the test actions, not incidental: keep the list to secrets the
# console genuinely manages (it is the same set it can write).
resource "google_secret_manager_secret_iam_member" "admin_accessor" {
  for_each = toset(var.admin_writable_secret_ids)

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.admin_sa_email}"

  depends_on = [google_secret_manager_secret.secret]
}

# Same secretAccessor grant, for identities beyond the nominal runtime SA. Kept
# as its own resource so the existing accessor bindings above are not rekeyed
# (that would destroy and recreate all of them).
resource "google_secret_manager_secret_iam_member" "extra_accessor" {
  for_each = {
    for pair in setproduct(var.secret_ids, var.extra_accessor_members) :
    "${pair[0]}|${pair[1]}" => { secret_id = pair[0], member = pair[1] }
  }

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member

  depends_on = [google_secret_manager_secret.secret]
}
