output "database_name" {
  description = "Firestore database resource name."
  value       = google_firestore_database.default.name
}

output "location_id" {
  description = "Firestore location (immutable)."
  value       = google_firestore_database.default.location_id
}

output "pitr_enabled" {
  description = "Whether point-in-time recovery is on. Surfaced so `terraform output` answers the recoverability question without a Console visit."
  value       = google_firestore_database.default.point_in_time_recovery_enablement == "POINT_IN_TIME_RECOVERY_ENABLED"
}

output "daily_backup_retention" {
  description = "Retention of the daily managed backup schedule, or null when no schedule is configured."
  value       = var.enable_daily_backup ? google_firestore_backup_schedule.daily[0].retention : null
}
