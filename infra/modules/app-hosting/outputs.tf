output "backend_uris" {
  description = "backend_id => the *.hosted.app serving URL."
  value       = { for k, b in google_firebase_app_hosting_backend.this : k => b.uri }
}

output "backend_ids" {
  description = "The backend ids under management, for the deploy workflows' rollout target."
  value       = keys(google_firebase_app_hosting_backend.this)
}
