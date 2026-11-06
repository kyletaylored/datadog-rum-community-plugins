---
'@kyletaylored/datadog-rum-plugin-woocommerce': minor
---

Read the WP Consent API, which the plugin advertised but never read. With the default `consent: 'auto'` and the API on the page, the plugin calls `wp_has_consent('statistics')` before sending anything and listens for `wp_listen_for_consent_change`: a refusal holds every event, the customer ID included, and every other community plugin on the page, and a later grant opens the gate without backfilling. It never calls `setTrackingConsent`. A new `consentCategory` option picks a category other than `statistics`. Without the API nothing changes: the plugin follows the page.
