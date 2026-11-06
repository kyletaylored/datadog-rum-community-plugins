# @kyletaylored/datadog-rum-community-plugins

## 0.3.0

### Minor Changes

- a01218d: Misconfiguration is no longer silent. Warnings now print without `debug: true`, each distinct one once per page: a missing platform API, OneTrust never reporting, a `beforeTrack` hook that throws. A new one fires when events are being dropped because consent is still pending more than 5 seconds after the plugin started, which usually means a consent plugin that never answers. A refusal by the visitor stays quiet. Per-event lines, every mapped event and every drop, still need `debug: true`.
- b87d9d3: Consent now follows the page, and no adapter can switch RUM off or release it.
  
  Before, the default `consent: 'auto'` set `trackingConsent = 'not-granted'` in any plugin that passed its init options, and waited for a grant that a plugin with no consent source never received. Engagement, WooCommerce and LearnDash with default options sent no events at all, and on their own they held the whole SDK, so the site sent no RUM. Each plugin's gate was also separate: a grant from OneTrust opened none of the others, and any adapter that granted called `setTrackingConsent('granted')` for the whole SDK, releasing RUM that OneTrust was holding.
  
  Now every gate reads one page-wide consent record (`globalThis.__DD_RUM_COMMUNITY_CONSENT__`), shared across CDN bundles that each carry their own core:
  
  - A plugin with no consent signal follows the page. With no consent plugin present it sends freely and leaves `trackingConsent` to the host page; next to OneTrust it holds its events until OneTrust grants, whatever the order in `plugins`.
  - Only a consent plugin, or a host-supplied `consent` resolver, holds RUM or calls `setTrackingConsent`. An adapter that reads a platform signal records its decision and gates its own events, but never widens the SDK's consent.
  - When several sources decide, the most restrictive wins.
  
  Core API: `createConsentGate` takes a `name`, and `pageConsent()`, `pageConsentState()` and `resetPageConsent()` are exported. The unused `onBlocked` and `notifyBlocked` are removed from `ConsentGate`. The conformance suite adds a `consent-owner` rule: a plugin outside the consent family must not change `trackingConsent` or call `setTrackingConsent`.
  
  WooCommerce's footprint no longer claims the WP Consent API as a consent source, since nothing read it.
- f4262ea: Export `blockedKeys(payload)`: every key in a payload the PII filter refuses. Used to say what was stripped (the sandbox feed, the plugin pages), never to decide what is sent.
- 22551ac: The plugin manifest schema requires `howItWorks`: a summary and ordered steps saying what the plugin does on a page, meaning the listeners it adds, the platform APIs and globals it reads, and how it reports. `PluginManifest` gains the matching field.
- fd76323: Schema 1.2.0 adds the `learning` family, for course platforms: `learning.course_enroll`, `lesson_complete`, `quiz_start`, `quiz_complete` and `course_complete`, with course, lesson and quiz IDs and names, `step_type`, `score`, `score_max`, `passed`, `attempt` and `progress_percent`. Import `LEARNING_FAMILY` into a plugin's tracker. Additive: every 1.1.0 action and attribute is unchanged.

## 0.2.0

### Minor Changes

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
