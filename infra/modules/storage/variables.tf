variable "project_id" {
  type        = string
  description = "Project to create the Firebase Storage bucket in."
}

variable "storage_location" {
  type        = string
  description = "GCS bucket location (immutable after first apply)."
  default     = "europe-west6"
}
