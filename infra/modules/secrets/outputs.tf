output "secret_ids" {
  description = "The secret container IDs created by this module."
  value       = [for s in google_secret_manager_secret.secret : s.secret_id]
}
