variable "project_id" {
  type        = string
  description = "Firebase/GCP project ID for this environment."
}

variable "region" {
  type        = string
  description = "Default region for functions, tasks, etc."
  default     = "europe-west6"
}

variable "firestore_location" {
  type        = string
  description = "Firestore location (immutable after first apply)."
  default     = "europe-west6"
}

variable "storage_location" {
  type        = string
  description = "Firebase Storage bucket location (immutable after first apply)."
  default     = "europe-west6"
}

# ── Project creation ──────────────────────────────────────────────────────────
variable "create_project" {
  type        = bool
  description = "If true, Terraform creates the GCP project. If false, references an existing one."
  default     = true
}

variable "billing_account" {
  type        = string
  description = "Billing account ID to link to the project and budget."
}

variable "org_id" {
  type        = string
  description = "Organization ID under which to create the project. Mutually exclusive with folder_id."
  default     = null
}

variable "folder_id" {
  type        = string
  description = "Folder ID under which to create the project. Mutually exclusive with org_id."
  default     = null
}

# ── CI deploy SA (from bootstrap outputs) ─────────────────────────────────────
variable "deploy_sa_email" {
  type        = string
  description = "Email of the CI deploy service account created in the bootstrap stack."
}

# ── Hosting site IDs (must match .firebaserc) ─────────────────────────────────
variable "app_site_id" {
  type        = string
  description = "Hosting site ID for the web app."
  default     = "linyup-sandbox"
}

variable "landing_site_id" {
  type        = string
  description = "Hosting site ID for the landing site."
  default     = "linyup-sandbox-landing"
}

# ── Secrets ───────────────────────────────────────────────────────────────────
variable "secret_ids" {
  type        = list(string)
  description = "Secret Manager containers to create (values added out-of-band)."
  default = [
    "stripe-secret-key",
    "stripe-webhook-secret",
    "stripe-connect-webhook-secret",
    "smtp-password",
    "smtp-encryption-key",
    "posthog-api-key",
    "ai-assistant-unlock-key", # strong key to unlock the locked AI assistant plugin
  ]
}

# ── Budget ────────────────────────────────────────────────────────────────────
variable "budget_amount" {
  type        = number
  description = "Monthly budget amount in whole currency units."
  default     = 30
}
