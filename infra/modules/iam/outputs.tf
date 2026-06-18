output "functions_runtime_email" {
  description = "Email of the dedicated Cloud Functions runtime service account."
  value       = google_service_account.functions_runtime.email
}

output "admin_runtime_email" {
  description = "Email of the dedicated admin console (App Hosting) runtime service account."
  value       = google_service_account.admin_runtime.email
}
