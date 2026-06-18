variable "project_id" {
  type        = string
  description = "Project to create the secret containers on."
}

variable "secret_ids" {
  type        = list(string)
  description = "Secret Manager secret IDs to create (containers only, no values)."
}

variable "runtime_sa_email" {
  type        = string
  description = "Email of the functions runtime service account granted secretAccessor."
}

variable "admin_sa_email" {
  type        = string
  description = "Email of the admin console runtime SA, granted secretVersionAdder on admin_writable_secret_ids."
}

variable "admin_writable_secret_ids" {
  type        = list(string)
  description = "Secret IDs the admin console may write new versions to (must be a subset of secret_ids). The Settings UI sets the global SMTP password here."
  default     = ["smtp-password"]
}
