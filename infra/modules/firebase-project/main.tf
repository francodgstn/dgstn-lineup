# Initialises Firebase on the project and creates the app-layer shells that the
# Firebase CLI later fills with content:
#   - the Firebase project itself
#   - a Web App (whose generated config feeds the NEXT_PUBLIC_* env vars)
#   - the two Hosting sites (app + landing)
#
# All google_firebase_* resources REQUIRE the google-beta provider.

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id
}

# ── Web App — generates the public client SDK config ──────────────────────────
resource "google_firebase_web_app" "app" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Linyup ${var.env} Web"

  # Avoid deleting the web app (and its config) on a stray destroy.
  deletion_policy = "ABANDON"

  depends_on = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "app" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.app.app_id
}

# ── Hosting sites — site_id MUST match the IDs declared in .firebaserc ─────────
# The target→site mapping (target:apply) stays with the Firebase CLI; Terraform
# only owns the site shells.
resource "google_firebase_hosting_site" "app" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.app_site_id

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_hosting_site" "landing" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.landing_site_id

  depends_on = [google_firebase_project.this]
}
