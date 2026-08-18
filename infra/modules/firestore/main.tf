# Creates the Firestore database INSTANCE only. Rules and the 100+ composite
# indexes stay in the repo (firestore.rules / firestore.index.json) and are
# deployed by the Firebase CLI — never modelled here.
#
# WARNING: location_id is IMMUTABLE for the life of the project. europe-west6
# (Zurich) is set on the first apply and can never be changed afterwards.
#
# THREE INDEPENDENT GUARDS protect this database, and they are not redundant —
# each stops a different actor:
#   - prevent_destroy        → stops TERRAFORM from planning a destroy
#   - deletion_policy ABANDON→ stops a `terraform destroy` from deleting the real DB
#   - delete_protection_state→ stops a HUMAN in the Console or gcloud, i.e. the
#                              one path the two Terraform-level guards cannot see
# If a plan ever proposes REPLACING this resource, stop and find out why. That is
# a signal, not an obstacle.

resource "google_firestore_database" "default" {
  provider    = google-beta
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  concurrency_mode            = "PESSIMISTIC"
  app_engine_integration_mode = "DISABLED"

  # Continuous 7-day recovery window. This is the cheapest protection that exists
  # against the failure mode that actually threatens this product: a bad backfill
  # or a bad rules deploy silently corrupting tenant data. Restores are served
  # from any microsecond in the window, so it covers "we got it wrong an hour ago"
  # — which scheduled backups, being daily snapshots, do not.
  point_in_time_recovery_enablement = var.enable_pitr ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"

  # Refuses deletion at the GCP level, not just the Terraform level.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"

  # Never let Terraform delete the live database.
  deletion_policy = "ABANDON"

  lifecycle {
    prevent_destroy = true
  }
}

# Daily managed backups. These complement PITR rather than duplicating it: PITR
# gives fine-grained recovery but only over a 7-day window, so a corruption
# discovered on day 8 is unrecoverable from PITR alone. Backups extend the reach.
#
# LIMIT worth knowing before an incident: a managed backup restores into a NEW
# database in the SAME project. It is not a portable artefact, and it does not
# survive loss of the project itself. The off-project copy is a scheduled GCS
# export, which is tracked separately — do not treat this resource as covering it.
resource "google_firestore_backup_schedule" "daily" {
  count = var.enable_daily_backup ? 1 : 0

  provider = google-beta
  project  = var.project_id
  database = google_firestore_database.default.name

  # Seconds, max 14 weeks (8467200s).
  retention = var.backup_retention

  daily_recurrence {}
}
