variable "project_id" {
  type        = string
  description = "GCP project id the backends live in."
}

variable "location" {
  type        = string
  default     = "europe-west4"
  description = <<-EOT
    App Hosting region. europe-west4 (Netherlands) is the nearest EU region —
    App Hosting does NOT run in europe-west6, where Firestore/Functions live.
    us-central1 is legacy (no EU region existed when the first backends were
    created); every backend is being moved to europe-west4.
  EOT
}

variable "app_id" {
  type        = string
  description = "Firebase Web App id (1:NNN:web:XXXX). Both web and admin backends link to the same web app."
}

variable "repository" {
  type        = string
  description = <<-EOT
    Full resource name of the Developer Connect gitRepositoryLink the backends
    build from, e.g.
    projects/<p>/locations/europe-west4/connections/<conn>/gitRepositoryLinks/<link>.

    The connection + link are NOT managed here (Firebase creates them with its
    own GitHub App when you Connect the repository in the Console, which does not
    import cleanly into terraform's google_developer_connect_connection). They
    are a set-once, per-project artifact; this module only owns the backends that
    reference them. Read the current value with:
      gcloud developer-connect connections git-repository-links list \
        --project <p> --location europe-west4 --connection <conn>
  EOT
}

variable "backends" {
  description = <<-EOT
    backend_id => backend config. root_directory is stored with a LEADING SLASH
    ("/apps/web"), matching what `apphosting:backends:create --root-dir apps/web`
    writes — a value without the slash will show a permanent diff on import.
    service_account must already hold roles/firebaseapphosting.computeRunner:
    the shared firebase-app-hosting-compute SA for the web app, the dedicated
    linyup-admin SA for the operator console (it writes Firestore + the SMTP
    secret). environment selects apphosting.<env>.yaml; null uses apphosting.yaml.
  EOT
  type = map(object({
    root_directory  = string
    service_account = string
    environment     = optional(string)
    display_name    = optional(string)
  }))
}
