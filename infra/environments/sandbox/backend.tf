terraform {
  backend "gcs" {
    # Same state bucket as the other stacks (bootstrap output `tf_state_bucket`).
    bucket = "linyup-tfstate-dgstn"
    prefix = "env/sandbox"
  }
}
