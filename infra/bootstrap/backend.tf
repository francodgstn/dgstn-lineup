# ─────────────────────────────────────────────────────────────────────────────
# Remote state backend for the bootstrap stack.
#
# LEAVE THIS COMMENTED OUT for the very first `terraform apply` — the bucket it
# points at does not exist yet (this stack creates it). After the first apply
# succeeds with local state:
#   1. uncomment the block below,
#   2. replace <STATE_BUCKET> with the `tf_state_bucket` output value,
#   3. run `terraform init -migrate-state` to move local state into GCS.
# ─────────────────────────────────────────────────────────────────────────────

# terraform {
#   backend "gcs" {
#     bucket = "<STATE_BUCKET>" # linyup-tfstate-<suffix>
#     prefix = "bootstrap"
#   }
# }
