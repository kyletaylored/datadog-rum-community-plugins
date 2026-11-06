# @kyletaylored/datadog-rum-plugin-learndash

## 0.2.0

### Minor Changes

- df265fa: New plugin for LearnDash, the WordPress LMS: `learning.course_enroll`, `lesson_complete` (lessons and topics), `quiz_start`, `quiz_complete` (score, pass, attempt, never the answers) and `course_complete`. Completions come from a payload the companion WordPress plugin prints, `window.ddRumLearnDash`, and each event is reported once per browser by its ID. The quiz start comes from the start button's click. The learner is identified by WordPress user ID only. Pair it with the engagement kit for lesson video.

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
- Updated dependencies [a01218d]
- Updated dependencies [b87d9d3]
- Updated dependencies [f4262ea]
- Updated dependencies [22551ac]
- Updated dependencies [fd76323]
  - @kyletaylored/datadog-rum-community-plugins@0.3.0
