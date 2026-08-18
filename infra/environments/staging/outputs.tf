# Public Firebase web config — feed these into GitHub Actions variables (vars.*)
# consumed by deploy.yml:
#   terraform output -json firebase_web_config
output "firebase_web_config" {
  description = "Public Firebase client config (NEXT_PUBLIC_* values) for the web build."
  value       = module.firebase.web_config
}

output "functions_runtime_sa" {
  description = "Cloud Functions runtime service account email."
  value       = module.iam.functions_runtime_email
}

output "admin_runtime_sa" {
  description = "Admin console (App Hosting) runtime service account email. Point the apps/admin backend at this SA."
  value       = module.iam.admin_runtime_email
}

output "project_number" {
  description = "Numeric project number."
  value       = local.project_number
}

output "secret_ids" {
  description = "Secret Manager containers created (populate values with gcloud)."
  value       = module.secrets.secret_ids
}

# Whether an alert can actually reach a human in this environment. FALSE means
# the error metric and uptime check are collecting but nothing pages anyone —
# set `alert_email` in terraform.tfvars. Surfaced as an output because a green
# metric in the Console looks identical either way.
output "monitoring_alerting_enabled" {
  description = "False = nothing pages anyone. Set alert_email in terraform.tfvars."
  value       = module.monitoring.alerting_enabled
}
