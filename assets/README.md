# Datadog asset pack

Because every adapter emits the same schema, one pack works for all platforms.

| Path | What it is | How to apply it |
| --- | --- | --- |
| `terraform/generated-metrics.tf` | The six commerce metrics plus three non-commerce counts | `terraform apply -var rum_application_id=<id>` |
| `dashboards/commerce-overview.json` | Orders, revenue, AOV, conversion, funnel, revenue next to errors and checkout performance, and abandoned checkouts with replays | Dashboards → New → Import JSON, or the API |
| `monitors/commerce-monitors.json` | Order and revenue anomaly monitors, plus conversion and checkout-error thresholds | `datadog_monitor` resources, or the API |

## Read these numbers correctly

They come from the browser, so they undercount: ad blockers, closed tabs before the thank-you
page, and declined consent all remove sessions. **Compare trends, not totals**, against the
platform's own order report, which stays the source of truth.

The PRD's accuracy gate is order count within 5% of the platform admin over 7 days. If a store is
further out than that, check consent coverage and whether the thank-you page is reached at all
before suspecting the mapping.

## Cost

RUM generated metrics are billed as custom metrics. This pack creates exactly nine and groups
only by `commerce_platform`, `currency` and `store_currency` — never by order, cart or user ID,
which would be unbounded.

## Before you page anyone on these

The two anomaly monitors work out of the box. The two threshold monitors are tagged
`tune-me:threshold` and ship with placeholder numbers: pull a week of the underlying metric for
the store in question and set the threshold below its normal floor. A conversion monitor set to
someone else's benchmark will page constantly or never.
