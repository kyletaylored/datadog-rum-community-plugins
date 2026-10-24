---
'@kyletaylored/datadog-rum-community-plugins': minor
'@kyletaylored/datadog-rum-plugin-shopify': minor
'@kyletaylored/datadog-rum-plugin-woocommerce': minor
'@kyletaylored/datadog-rum-plugin-onetrust': minor
---

Phase 0: the shared core, the test harness and the first three adapters.

**Core** — the `commerce`, `account`, `lead` and `support` schemas at version 1.0.0, with GA4 event
names behind a family prefix and GA4 parameter names for attributes. Plus the safety layers every
adapter inherits: the consent gate, the PII and payment-data filter, size caps, purchase dedupe per
`transaction_id`, the `beforeTrack` hook and the debug log.

**Shopify** — checkout events, order value and customer identity from Web Pixels, composed with the
official `@datadog/browser-rum-shopify` plugin rather than replacing it. It subscribes only to the
events the official plugin leaves alone and never touches `initConfiguration`.

**WooCommerce** — cart and checkout events from Woo's own storefront DOM events, plus
`commerce.purchase` from a payload rendered on the order-received page, since WooCommerce exposes no
client-side order object.

**OneTrust** — holds RUM until the visitor accepts the analytics category, listening on all four of
OneTrust's known signals and failing closed if none of them reports.

Every adapter stays under the 5 KB gzip CDN budget and passes the shared conformance suite.
