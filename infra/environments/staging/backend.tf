terraform {
  backend "gcs" {
    # Replace <STATE_BUCKET> with the bootstrap stack's tf_state_bucket output.
    bucket = "<STATE_BUCKET>" # linyup-tfstate-<suffix>
    prefix = "env/staging"
  }
}
