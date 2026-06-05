variable "project_id" {
  type        = string
  description = "Project on which to enable the APIs."
}

variable "apis" {
  type        = list(string)
  description = "List of API service names to enable (e.g. firestore.googleapis.com)."
}
