# Makes a production failure reach a human.
#
# Before this module, `infra/` contained exactly one alerting resource — a
# billing budget — so the only thing that could page anyone was spending money.
# A Stripe webhook throwing on every event, or a total outage, was detected by a
# customer complaining. MTTD was "whenever someone notices".
#
# TWO HALVES, DELIBERATELY SEPARATED:
#
#   MEASUREMENT always exists. The log-based metric and the uptime check need no
#   address and are created unconditionally, so the data is accumulating from the
#   moment this applies — including for the period before anyone decided who to
#   notify. Retrofitting history is impossible; starting the clock early is free.
#
#   NOTIFICATION waits on `alert_email`. Alert policies are created only once an
#   address exists, because a policy with no channel is worse than no policy: it
#   goes green in the Console and pages nobody. `alerting_enabled` in the outputs
#   says which state you are in — do not infer it from the presence of a metric.
#
# The ops console's Health page links straight at these (Alerting group in
# `apps/admin/src/lib/opsLinks.ts`). Until `alert_email` is set there, those links
# open an empty page — which is honest, not broken.

locals {
  alerting_enabled = var.alert_email != ""
  uptime_enabled   = var.uptime_host != ""

  # Monitoring REFUSES a condition filter with no `resource.type` restriction
  # (400: "must specify a restriction on resource.type"), so the metric's
  # deliberately broad `severity>=ERROR` has to be narrowed back down here. Both
  # types are needed and they are not interchangeable: Cloud Functions log as
  # `cloud_function`, while App Hosting runs the two Next apps on Cloud Run and
  # their server-side throws log as `cloud_run_revision`. One condition per type,
  # OR-combined, rather than a single `one_of(...)` filter — same result, but
  # each type gets its own named condition in the Console, so an alert says which
  # half of the stack is failing before you open anything.
  error_resource_types = ["cloud_function", "cloud_run_revision"]
}

# ── Where an alert goes ───────────────────────────────────────────────────────
resource "google_monitoring_notification_channel" "email" {
  count = local.alerting_enabled ? 1 : 0

  project      = var.project_id
  display_name = "Linyup ${var.env} — ops email"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}

# ── What counts as "something is wrong" ───────────────────────────────────────
# One counter over every ERROR-and-above log entry in the project. That spans
# Cloud Functions AND both Next apps, because App Hosting runs them on Cloud Run
# and their server-side throws land in the same log stream — so a single metric
# covers every render, server action, callable and webhook.
resource "google_logging_metric" "errors" {
  project = var.project_id
  name    = "linyup-error-count"
  filter  = "severity>=ERROR"

  description = "ERROR-and-above log entries across functions and both SSR apps. Backs the ops alert policy."

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Linyup error count"
  }
}

resource "google_monitoring_alert_policy" "errors" {
  count = local.alerting_enabled ? 1 : 0

  project      = var.project_id
  display_name = "Linyup ${var.env} — error rate"
  combiner     = "OR"

  documentation {
    content   = <<-EOT
      ERROR-severity logs in ${var.project_id} exceeded ${var.error_threshold} in a
      five-minute window.

      1. Cloud Error Reporting — what is throwing, and since when.
      2. App Hosting rollouts — did this start with a deploy? Roll back if so.
      3. If money is involved, check Stripe webhook delivery. A failed delivery
         is silent everywhere else.

      The ops console's Health page has all three pre-filtered for this project.
    EOT
    mime_type = "text/markdown"
  }

  dynamic "conditions" {
    for_each = local.error_resource_types

    content {
      display_name = "ERROR logs > ${var.error_threshold} in 5 min (${conditions.value})"

      condition_threshold {
        filter = join(" AND ", [
          "metric.type=\"logging.googleapis.com/user/${google_logging_metric.errors.name}\"",
          "resource.type=\"${conditions.value}\"",
        ])
        comparison      = "COMPARISON_GT"
        threshold_value = var.error_threshold
        # Fire on the first window that breaches. A longer duration would mean a
        # burst that stops on its own never pages anyone — which is exactly the
        # webhook-broke-for-ten-minutes case worth knowing about.
        duration = "0s"

        aggregations {
          alignment_period   = "300s"
          per_series_aligner = "ALIGN_SUM"
        }

        trigger {
          count = 1
        }
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]

  alert_strategy {
    # Stop re-notifying about a condition that has already been acknowledged and
    # is still firing; 30 minutes is long enough to be working on it.
    auto_close = "1800s"
  }
}

# ── Is it answering at all ────────────────────────────────────────────────────
# Hits /api/health, which reports the resolved Firebase project id — so this
# check also fails loudly if a deployment is ever pointed at the wrong project.
resource "google_monitoring_uptime_check_config" "app" {
  count = local.uptime_enabled ? 1 : 0

  project      = var.project_id
  display_name = "Linyup ${var.env} — web app"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.uptime_host
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  count = local.alerting_enabled && local.uptime_enabled ? 1 : 0

  project      = var.project_id
  display_name = "Linyup ${var.env} — web app unreachable"
  combiner     = "OR"

  documentation {
    content   = "${var.uptime_host} stopped answering /api/health. Check App Hosting rollouts first — a failed rollout is the usual cause."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Uptime check failing"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "resource.type=\"uptime_url\"",
        "metric.label.check_id=\"${google_monitoring_uptime_check_config.app[0].uptime_check_id}\"",
      ])
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      # Two consecutive failed windows, so one flaky probe from a single region
      # does not wake anybody.
      duration = "600s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
}
