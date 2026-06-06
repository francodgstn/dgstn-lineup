variable "project_id" {
  type        = string
  description = "Environment project to apply IAM on."
}

variable "deploy_sa_email" {
  type        = string
  description = "Email of the CI deploy service account (created in the bootstrap stack)."
}

variable "deploy_sa_roles" {
  type        = list(string)
  description = "Project-level roles granted to the deploy SA so firebase deploy succeeds."
  default = [
    "roles/firebase.admin",
    "roles/firebaseapphosting.admin",
    "roles/cloudfunctions.developer",
    "roles/run.admin",
    # Scheduled functions (onSchedule) create/update Cloud Scheduler jobs;
    # task-queue functions (onTaskDispatched) create/update Cloud Tasks queues.
    # Without these the deploy 403s on dailyTasks/weeklyReports/executeDelayedRule.
    "roles/cloudscheduler.admin",
    "roles/cloudtasks.admin",
    "roles/cloudbuild.builds.editor",
    "roles/artifactregistry.admin",
    "roles/iam.serviceAccountUser",
    "roles/datastore.indexAdmin",
    "roles/firebaserules.admin",
    "roles/eventarc.developer",
    "roles/secretmanager.viewer",
    "roles/serviceusage.serviceUsageConsumer",
    "roles/resourcemanager.projectIamAdmin",
  ]
}
