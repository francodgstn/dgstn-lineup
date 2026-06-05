output "enabled_apis" {
  description = "The set of API services enabled by this module."
  value       = [for s in google_project_service.services : s.service]
}
