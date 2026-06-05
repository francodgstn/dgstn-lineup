# Billing budget + threshold alerts for an environment's project.
# Requires the billingbudgets API enabled and the caller to have billing perms
# on the billing account.

resource "google_billing_budget" "this" {
  billing_account = var.billing_account
  display_name    = "Linyup ${var.env} budget"

  budget_filter {
    projects = ["projects/${var.project_number}"]
  }

  amount {
    specified_amount {
      currency_code = var.currency_code
      units         = tostring(var.budget_amount)
    }
  }

  dynamic "threshold_rules" {
    for_each = var.threshold_percents
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }
}
