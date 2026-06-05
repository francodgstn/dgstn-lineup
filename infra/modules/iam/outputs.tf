output "functions_runtime_email" {
  description = "Email of the dedicated Cloud Functions runtime service account."
  value       = google_service_account.functions_runtime.email
}
