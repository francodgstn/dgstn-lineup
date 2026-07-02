# Creates the default Firebase Storage bucket and links it to the Firebase project.
#
# Without this, `firebase deploy --only storage` fails with "Firebase Storage has
# not been set up". The underlying GCS bucket is created first, then linked to
# Firebase via the google_firebase_storage_bucket resource.
#
# WARNING: location is effectively IMMUTABLE — changing it requires deleting and
# recreating the bucket (and losing all data). europe-west6 (Zurich) is locked on
# the first apply.

resource "google_storage_bucket" "default" {
  provider = google-beta
  project  = var.project_id
  name     = "${var.project_id}.firebasestorage.app"
  location = var.storage_location

  uniform_bucket_level_access = true

  # Never let Terraform delete the bucket with its data.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_firebase_storage_bucket" "default" {
  provider  = google-beta
  project   = var.project_id
  bucket_id = google_storage_bucket.default.name

  depends_on = [google_storage_bucket.default]
}
