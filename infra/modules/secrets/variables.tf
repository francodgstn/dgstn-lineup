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
