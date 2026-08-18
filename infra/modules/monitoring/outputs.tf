output "alerting_enabled" {
  description = "Whether an alert can actually reach a human. False means the metric and uptime check are collecting but NOTHING pages anyone — set alert_email to change that."
  value       = local.alerting_enabled
}

output "uptime_enabled" {
  description = "Whether a public /api/health probe is configured for this environment."
  value       = local.uptime_enabled
}

output "error_metric_name" {
  description = "Log-based metric backing the error-rate alert."
  value       = google_logging_metric.errors.name
}
