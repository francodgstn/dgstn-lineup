terraform {
  backend "gcs" {
    # Replace <STATE_BUCKET> with the bootstrap stack's tf_state_bucket output.
    bucket = "linyup-tfstate-dgstn"
    prefix = "env/prod"
  }
}
