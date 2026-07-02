output "bucket_name" {
  description = "Name of the default Firebase Storage bucket."
  value       = google_storage_bucket.default.name
}

output "bucket_url" {
  description = "gs:// URL of the default Firebase Storage bucket."
  value       = google_storage_bucket.default.url
}
