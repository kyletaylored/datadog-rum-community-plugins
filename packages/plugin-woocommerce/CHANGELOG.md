# @kyletaylored/datadog-rum-plugin-woocommerce

## 0.3.0

### Minor Changes

- cda2584: Expose the checkout reporter on the CDN bundle as `window.DD_RUM_PLUGINS.woocommerce.createCheckoutReporter`, so a page without a bundler can report `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info` and `search`. `createCheckoutReporter` now also takes the plugin instance passed to `init`, resolving its tracker once `init` has run; a step reported before then is dropped with a console warning. Passing a tracker still works.

### Patch Changes

- fd76323: Emit schema 1.2.0 (`commerce.schema_version`). Nothing a plugin sends changes otherwise. The CDN bundles are smaller, by about 140 bytes gzipped each: every other family's event names had been leaking into every bundle through the schema spec's prefix reads, and no longer do.
- Updated dependencies [f4262ea]
- Updated dependencies [22551ac]
- Updated dependencies [fd76323]
  - @kyletaylored/datadog-rum-community-plugins@0.3.0

## 0.2.0

### Minor Changes

- 9657956: Phase 0: the shared core, the test harness and the first three adapters.
  
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

### Patch Changes

- 8fc61bc: Adds the engagement kit, and schema 1.1.0 with the `engagement` family.
  
  `@kyletaylored/datadog-rum-plugin-engagement` captures what an analytics tool captures
  automatically, with no instrumentation: scroll depth, outbound and contact clicks, file downloads,
  HTML5 video start/progress/complete, and form start/submit. A form marked `data-lead` also emits
  `lead.generate_lead`. It reads the page rather than a platform, so it runs anywhere and composes
  with the commerce and consent plugins.
  
  Three things it will never send, by construction rather than configuration: any URL (the query
  string is dropped, not truncated — `link_domain` and `link_path` replace GA4's `link_url`), any
  address behind a `mailto:` or `tel:` link, and any form field value.
  
  **Breaking for plugin authors:** `createTracker` now requires `families`, listing the families a
  plugin emits — `createTracker({ families: [COMMERCE_FAMILY], ... })`. Previously the tracker
  validated against every family in the schema, which meant adding a family grew every plugin's CDN
  bundle; adding `engagement` pushed two plugins over their size budget at once. Family event lists
  now live in one module each, and every aggregate over them is a function rather than a constant,
  so a plugin's bundle carries only the families it declares.
- Updated dependencies [8fc61bc]
- Updated dependencies [9657956]
  - @kyletaylored/datadog-rum-community-plugins@0.2.0
