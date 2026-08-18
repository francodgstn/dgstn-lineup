variable "project_id" {
  type        = string
  description = "Project to create the Firestore database on."
}

variable "firestore_location" {
  type        = string
  description = "Firestore location. IMMUTABLE after first apply. Linyup uses europe-west6."
  default     = "europe-west6"
}

variable "enable_pitr" {
  type        = bool
  description = "Point-in-time recovery (continuous 7-day window). ON everywhere by default — the cost is trivial next to losing a tenant's booking and payment history, and the emulator-only project never runs this module."
  default     = true
}

variable "enable_daily_backup" {
  type        = bool
  description = "Daily managed backup schedule. Restores into a NEW database in the SAME project — not a portable artefact, and no protection against loss of the project itself."
  default     = true
}

variable "backup_retention" {
  type        = string
  description = "Backup retention as a duration in seconds (e.g. \"604800s\"). Firestore caps daily-schedule retention at 14 weeks (\"8467200s\")."
  default     = "604800s" # 7 days

  validation {
    condition     = can(regex("^[0-9]+s$", var.backup_retention))
    error_message = "backup_retention must be a duration in seconds ending in 's', e.g. \"604800s\"."
  }
}
