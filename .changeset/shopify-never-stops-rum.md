---
'@kyletaylored/datadog-rum-plugin-shopify': minor
---

The Shopify plugin can no longer switch RUM off or release it.

- **No `analytics`, no harm.** Without the pixel's `analytics` the plugin returned `false` from `onInit`. In Browser SDK v7 that stops init for the whole page, so adding the plugin to a theme, or injecting it, meant no RUM at all. It now warns once in the console (without `debug`) and lets the rest of RUM run.
- **Never widens consent.** It used to call `setTrackingConsent('granted')` whenever the Customer Privacy API allowed analytics, and also when the page had no such API, which released RUM that OneTrust was holding. It now records the Customer Privacy API's answer on the page, where a refusal holds every community plugin, and never calls `setTrackingConsent`. With no API on the page it records nothing and follows the page.

`setTrackingConsent` is gone from the footprint.
