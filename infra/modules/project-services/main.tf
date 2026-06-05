# Enables the GCP APIs required by the Linyup stack on a project.
# disable_on_destroy = false so tearing down one stack never disables an API
# another stack (or live traffic) depends on.

resource "google_project_service" "services" {
  for_each = toset(var.apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
