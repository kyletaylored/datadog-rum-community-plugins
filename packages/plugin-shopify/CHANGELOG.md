# @kyletaylored/datadog-rum-plugin-shopify

## 0.3.0

### Minor Changes

- 7224592: The Shopify plugin can no longer switch RUM off or release it.
  
  - **No `analytics`, no harm.** Without the pixel's `analytics` the plugin returned `false` from `onInit`. In Browser SDK v7 that stops init for the whole page, so adding the plugin to a theme, or injecting it, meant no RUM at all. It now warns once in the console (without `debug`) and lets the rest of RUM run.
  - **Never widens consent.** It used to call `setTrackingConsent('granted')` whenever the Customer Privacy API allowed analytics, and also when the page had no such API, which released RUM that OneTrust was holding. It now records the Customer Privacy API's answer on the page, where a refusal holds every community plugin, and never calls `setTrackingConsent`. With no API on the page it records nothing and follows the page.
  
  `setTrackingConsent` is gone from the footprint.
- f40fd59: Storefront mode: the plugin now reports cart and browsing events when it runs outside a Web Pixel, as it does in a theme snippet, a tag manager or the RUM Injector. Before, every event came from `analytics.subscribe`, which only exists inside a pixel, so such an install collected nothing.
  
  With no `analytics` passed (or `mode: 'storefront'`), it reads:
  
  - `view_item`, `view_item_list`, `search` (length only) and the signed-in customer ID from `ShopifyAnalytics.meta`, which every Online Store theme prints;
  - `add_to_cart` and `remove_from_cart` by diffing `cart.js` snapshots. Resource timing notices the theme's cart requests by URL, and the plugin makes one tagged read of its own. `fetch` and XHR are never patched;
  - `view_cart` on the cart page, and `begin_checkout` on a click on a checkout control.
  
  Cart `attributes`, the note, line `properties` and the cart key are never read: on real stores they hold the shopper's email and app tokens. The cart snapshot is kept in `sessionStorage` as `dd_rum_shopify_cart`. Payment and purchase still need the pixel install.
  
  The CDN bundle now has a declared 6 KB budget, since it carries both adapters.

### Patch Changes

- 26e9faf: Smaller CDN bundles. They now target ES2020 instead of ES2019, so optional chaining and `??` ship as written instead of downleveled. Every plugin requires Browser SDK v7, whose own CDN bundle uses both untranspiled, so no browser that can run the SDK loses support. Saves 0.25 to 0.36 KB gzip per bundle. The npm builds are unchanged.
- a01218d: Misconfiguration is no longer silent. Warnings now print without `debug: true`, each distinct one once per page: a missing platform API, OneTrust never reporting, a `beforeTrack` hook that throws. A new one fires when events are being dropped because consent is still pending more than 5 seconds after the plugin started, which usually means a consent plugin that never answers. A refusal by the visitor stays quiet. Per-event lines, every mapped event and every drop, still need `debug: true`.
- fd76323: Emit schema 1.2.0 (`commerce.schema_version`). Nothing a plugin sends changes otherwise. The CDN bundles are smaller, by about 140 bytes gzipped each: every other family's event names had been leaking into every bundle through the schema spec's prefix reads, and no longer do.
- Updated dependencies [a01218d]
- Updated dependencies [b87d9d3]
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
