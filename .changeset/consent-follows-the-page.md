---
'@kyletaylored/datadog-rum-community-plugins': minor
'@kyletaylored/datadog-rum-plugin-engagement': patch
'@kyletaylored/datadog-rum-plugin-woocommerce': patch
'@kyletaylored/datadog-rum-plugin-learndash': patch
'@kyletaylored/datadog-rum-plugin-onetrust': patch
---

Consent now follows the page, and no adapter can switch RUM off or release it.

Before, the default `consent: 'auto'` set `trackingConsent = 'not-granted'` in any plugin that passed its init options, and waited for a grant that a plugin with no consent source never received. Engagement, WooCommerce and LearnDash with default options sent no events at all, and on their own they held the whole SDK, so the site sent no RUM. Each plugin's gate was also separate: a grant from OneTrust opened none of the others, and any adapter that granted called `setTrackingConsent('granted')` for the whole SDK, releasing RUM that OneTrust was holding.

Now every gate reads one page-wide consent record (`globalThis.__DD_RUM_COMMUNITY_CONSENT__`), shared across CDN bundles that each carry their own core:

- A plugin with no consent signal follows the page. With no consent plugin present it sends freely and leaves `trackingConsent` to the host page; next to OneTrust it holds its events until OneTrust grants, whatever the order in `plugins`.
- Only a consent plugin, or a host-supplied `consent` resolver, holds RUM or calls `setTrackingConsent`. An adapter that reads a platform signal records its decision and gates its own events, but never widens the SDK's consent.
- When several sources decide, the most restrictive wins.

Core API: `createConsentGate` takes a `name`, and `pageConsent()`, `pageConsentState()` and `resetPageConsent()` are exported. The unused `onBlocked` and `notifyBlocked` are removed from `ConsentGate`. The conformance suite adds a `consent-owner` rule: a plugin outside the consent family must not change `trackingConsent` or call `setTrackingConsent`.

WooCommerce's footprint no longer claims the WP Consent API as a consent source, since nothing read it.
