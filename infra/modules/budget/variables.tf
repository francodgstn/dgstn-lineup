variable "billing_account" {
  type        = string
  description = "Billing account ID the budget is attached to."
}

variable "project_number" {
  type        = string
  description = "Numeric project number the budget filters on."
}

variable "env" {
  type        = string
  description = "Environment label used in the budget display name."
}

variable "budget_amount" {
  type        = number
  description = "Budget amount in whole currency units."
}

variable "currency_code" {
  type        = string
  description = "ISO currency code for the budget."
  default     = "CHF"
}

variable "threshold_percents" {
  type        = list(number)
  description = "Spend thresholds (as fractions of the budget) that trigger alerts."
  default     = [0.5, 0.9, 1.0]
}
