output "tf_state_bucket" {
  description = "Name of the GCS bucket holding Terraform state. Put this in each environment's backend.tf."
  value       = google_storage_bucket.tf_state.name
}

output "wif_provider" {
  description = "Full resource name of the WIF provider. Set as GitHub secret GCP_WIF_PROVIDER."
  value       = "https://iam.googleapis.com/${google_iam_workload_identity_pool_provider.github.name}"
}

output "ci_deploy_sa_email" {
  description = "Email of the CI deploy service account. Set as GitHub secret GCP_DEPLOY_SA and pass to each environment's deploy_sa_email var."
  value       = google_service_account.ci_deploy.email
}
