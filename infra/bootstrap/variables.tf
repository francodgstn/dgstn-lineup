variable "bootstrap_project_id" {
  type        = string
  description = "Existing GCP project that hosts the shared bootstrap resources (TF state bucket, WIF pool, CI deploy SA). Can be a dedicated 'linyup-admin' project or a reused one."
}

variable "org_suffix" {
  type        = string
  description = "Short unique suffix to make the globally-unique state bucket name (linyup-tfstate-<suffix>). Use the org/billing short id or a random string."
}

variable "github_repo" {
  type        = string
  description = "owner/name of the GitHub repository allowed to assume the deploy SA via WIF."
  default     = "francodgstn/dgstn-linyup"
}

variable "region" {
  type        = string
  description = "Default provider region."
  default     = "europe-west6"
}

variable "state_bucket_location" {
  type        = string
  description = "Location for the Terraform state bucket (multi-region recommended)."
  default     = "EU"
}
