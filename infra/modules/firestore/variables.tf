variable "project_id" {
  type        = string
  description = "Project to create the Firestore database on."
}

variable "firestore_location" {
  type        = string
  description = "Firestore location. IMMUTABLE after first apply. Linyup uses europe-west6."
  default     = "europe-west6"
}
