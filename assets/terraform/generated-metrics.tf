# RUM generated metrics for the community commerce schema.
#
# These are computed from 100% of ingested RUM events, kept 15 months, and usable in anomaly and
# forecast monitors. They are billed as custom metrics, so this file creates exactly the six the
# dashboard and monitors need and no high-cardinality tags: never group by order, cart or user ID.
#
# The numbers are directional. They come from the browser and will undercount — ad blockers,
# closed tabs, declined consent — so they belong next to performance and errors, and never
# replace the platform's own order reporting.

terraform {
  required_providers {
    datadog = {
      source  = "DataDog/datadog"
      version = "~> 3.60"
    }
  }
}

variable "rum_application_id" {
  type        = string
  description = "The RUM application these metrics are computed from."
}

# Group-by tags shared across every metric. Deliberately low cardinality.
locals {
  commerce_group_by = [
    { path = "@context.commerce.platform", tag_name = "commerce_platform" },
    { path = "@context.currency", tag_name = "currency" },
    { path = "@context.store.currency", tag_name = "store_currency" },
  ]
}

resource "datadog_rum_metric" "orders" {
  name       = "rum.commerce.orders"
  event_type = "action"

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:commerce.purchase"
  }

  dynamic "group_by" {
    for_each = local.commerce_group_by
    content {
      path     = group_by.value.path
      tag_name = group_by.value.tag_name
    }
  }
}

resource "datadog_rum_metric" "revenue" {
  name       = "rum.commerce.revenue"
  event_type = "action"

  # A distribution, so the dashboard can show both total revenue and average order value.
  compute {
    aggregation_type    = "distribution"
    path                = "@context.value"
    include_percentiles = true
  }

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:commerce.purchase"
  }

  dynamic "group_by" {
    for_each = local.commerce_group_by
    content {
      path     = group_by.value.path
      tag_name = group_by.value.tag_name
    }
  }
}

resource "datadog_rum_metric" "items_per_order" {
  name       = "rum.commerce.items_per_order"
  event_type = "action"

  compute {
    aggregation_type    = "distribution"
    path                = "@context.item_count"
    include_percentiles = true
  }

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:commerce.purchase"
  }

  dynamic "group_by" {
    for_each = local.commerce_group_by
    content {
      path     = group_by.value.path
      tag_name = group_by.value.tag_name
    }
  }
}

resource "datadog_rum_metric" "checkouts_started" {
  name       = "rum.commerce.checkouts_started"
  event_type = "action"

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:commerce.begin_checkout"
  }

  dynamic "group_by" {
    for_each = local.commerce_group_by
    content {
      path     = group_by.value.path
      tag_name = group_by.value.tag_name
    }
  }
}

resource "datadog_rum_metric" "cart_value" {
  name       = "rum.commerce.cart_value"
  event_type = "action"

  # Cart total at the moment checkout is entered.
  compute {
    aggregation_type    = "distribution"
    path                = "@context.value"
    include_percentiles = true
  }

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:commerce.begin_checkout"
  }

  dynamic "group_by" {
    for_each = local.commerce_group_by
    content {
      path     = group_by.value.path
      tag_name = group_by.value.tag_name
    }
  }
}

resource "datadog_rum_metric" "checkout_errors" {
  name       = "rum.commerce.checkout_errors"
  event_type = "error"

  # Errors in a session that reached checkout. Session-scoped rather than view-scoped, because a
  # checkout can span several views and some platforms host it on a separate domain.
  filter {
    query = "@application.id:${var.rum_application_id} @session.has_replay:* @context.commerce.platform:*"
  }

  dynamic "group_by" {
    for_each = local.commerce_group_by
    content {
      path     = group_by.value.path
      tag_name = group_by.value.tag_name
    }
  }
}

# Non-commerce families. Counts only; no distributions, so no extra custom-metric cost beyond
# these three.
resource "datadog_rum_metric" "account_logins" {
  name       = "rum.account.logins"
  event_type = "action"

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:account.login"
  }
}

resource "datadog_rum_metric" "account_sign_ups" {
  name       = "rum.account.sign_ups"
  event_type = "action"

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:account.sign_up"
  }
}

resource "datadog_rum_metric" "leads" {
  name       = "rum.lead.leads"
  event_type = "action"

  filter {
    query = "@application.id:${var.rum_application_id} @action.name:lead.generate_lead"
  }
}
