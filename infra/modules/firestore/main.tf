# Creates the Firestore database INSTANCE only. Rules and the 100+ composite
# indexes stay in the repo (firestore.rules / firestore.index.json) and are
# deployed by the Firebase CLI — never modelled here.
#
# WARNING: location_id is IMMUTABLE for the life of the project. europe-west6
# (Zurich) is set on the first apply and can never be changed afterwards.

resource "google_firestore_database" "default" {
  provider    = google-beta
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  concurrency_mode            = "PESSIMISTIC"
  app_engine_integration_mode = "DISABLED"

  # Never let Terraform delete the live database.
  deletion_policy = "ABANDON"

  lifecycle {
    prevent_destroy = true
  }
}
