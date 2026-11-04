# budget.tf
# Monthly cost alert. Emails when actual spend passes 80% of the limit, or
# when AWS forecasts the month will go over it.
# Note: on the free plan, credits cover costs, so "actual" spend may stay at
# $0 until the credits run out. The alert still guards against surprises.

variable "budget_alert_email" {
  description = "Email address that receives budget alerts. Set it in terraform.tfvars (gitignored)."
  type        = string
}

variable "budget_limit_usd" {
  description = "Monthly budget limit in USD."
  type        = number
  default     = 5
}

resource "aws_budgets_budget" "monthly" {
  name         = "n8n-practice-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
