output "database_name" {
  description = "Firestore database resource name."
  value       = google_firestore_database.default.name
}

output "location_id" {
  description = "Firestore location (immutable)."
  value       = google_firestore_database.default.location_id
}
