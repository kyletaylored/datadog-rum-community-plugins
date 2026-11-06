# @kyletaylored/datadog-rum-plugin-engagement

## 0.2.1

### Patch Changes

- 26e9faf: Smaller CDN bundles. They now target ES2020 instead of ES2019, so optional chaining and `??` ship as written instead of downleveled. Every plugin requires Browser SDK v7, whose own CDN bundle uses both untranspiled, so no browser that can run the SDK loses support. Saves 0.25 to 0.36 KB gzip per bundle. The npm builds are unchanged.
- a01218d: Misconfiguration is no longer silent. Warnings now print without `debug: true`, each distinct one once per page: a missing platform API, OneTrust never reporting, a `beforeTrack` hook that throws. A new one fires when events are being dropped because consent is still pending more than 5 seconds after the plugin started, which usually means a consent plugin that never answers. A refusal by the visitor stays quiet. Per-event lines, every mapped event and every drop, still need `debug: true`.
- b87d9d3: Consent now follows the page, and no adapter can switch RUM off or release it.
  
  Before, the default `consent: 'auto'` set `trackingConsent = 'not-granted'` in any plugin that passed its init options, and waited for a grant that a plugin with no consent source never received. Engagement, WooCommerce and LearnDash with default options sent no events at all, and on their own they held the whole SDK, so the site sent no RUM. Each plugin's gate was also separate: a grant from OneTrust opened none of the others, and any adapter that granted called `setTrackingConsent('granted')` for the whole SDK, releasing RUM that OneTrust was holding.
  
  Now every gate reads one page-wide consent record (`globalThis.__DD_RUM_COMMUNITY_CONSENT__`), shared across CDN bundles that each carry their own core:
  
  - A plugin with no consent signal follows the page. With no consent plugin present it sends freely and leaves `trackingConsent` to the host page; next to OneTrust it holds its events until OneTrust grants, whatever the order in `plugins`.
  - Only a consent plugin, or a host-supplied `consent` resolver, holds RUM or calls `setTrackingConsent`. An adapter that reads a platform signal records its decision and gates its own events, but never widens the SDK's consent.
  - When several sources decide, the most restrictive wins.
  
  Core API: `createConsentGate` takes a `name`, and `pageConsent()`, `pageConsentState()` and `resetPageConsent()` are exported. The unused `onBlocked` and `notifyBlocked` are removed from `ConsentGate`. The conformance suite adds a `consent-owner` rule: a plugin outside the consent family must not change `trackingConsent` or call `setTrackingConsent`.
  
  WooCommerce's footprint no longer claims the WP Consent API as a consent source, since nothing read it.
- 10029e5: Drop `link_text` on a `mailto:` or `tel:` click when the visible text is the address or the number itself. Before, a link reading "sales@example.com" sent that address as its text. `video_start` is also now recorded with `video_duration` in the fixture run, as a browser reports it.
- fd76323: Emit schema 1.2.0 (`commerce.schema_version`). Nothing a plugin sends changes otherwise. The CDN bundles are smaller, by about 140 bytes gzipped each: every other family's event names had been leaking into every bundle through the schema spec's prefix reads, and no longer do.
- Updated dependencies [a01218d]
- Updated dependencies [b87d9d3]
- Updated dependencies [f4262ea]
- Updated dependencies [22551ac]
- Updated dependencies [fd76323]
  - @kyletaylored/datadog-rum-community-plugins@0.3.0

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

### Patch Changes

- Updated dependencies [8fc61bc]
- Updated dependencies [9657956]
  - @kyletaylored/datadog-rum-community-plugins@0.2.0
