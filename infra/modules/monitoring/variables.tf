variable "project_id" {
  type        = string
  description = "Project to create the monitoring resources on."
}

variable "env" {
  type        = string
  description = "Environment name, used in alert display names (sandbox / staging / prod)."
}

variable "alert_email" {
  type        = string
  description = <<-EOT
    Where alerts are sent. EMPTY MEANS NOBODY IS NOTIFIED — the metric and the
    uptime check are still created and collecting, but no alert policy exists.
    Set it in the environment's (gitignored) terraform.tfvars. Check
    `alerting_enabled` in the outputs rather than assuming.
  EOT
  default     = ""
}

variable "uptime_host" {
  type        = string
  description = "Public hostname to probe at /api/health, e.g. app.linyup.com. Empty disables the uptime check — correct for an environment with no public URL."
  default     = ""
}

variable "error_threshold" {
  type        = number
  description = "ERROR-severity log entries in a 5-minute window before the alert fires. Deliberately not zero: a single handled-and-logged failure is not an incident, and an alert that cries wolf gets muted, which is worse than no alert."
  default     = 5
}
