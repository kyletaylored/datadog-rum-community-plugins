---
'@kyletaylored/datadog-rum-community-plugins': minor
'@kyletaylored/datadog-rum-plugin-engagement': patch
'@kyletaylored/datadog-rum-plugin-woocommerce': patch
'@kyletaylored/datadog-rum-plugin-learndash': patch
'@kyletaylored/datadog-rum-plugin-onetrust': patch
'@kyletaylored/datadog-rum-plugin-shopify': patch
---

Misconfiguration is no longer silent. Warnings now print without `debug: true`, each distinct one once per page: a missing platform API, OneTrust never reporting, a `beforeTrack` hook that throws. A new one fires when events are being dropped because consent is still pending more than 5 seconds after the plugin started, which usually means a consent plugin that never answers. A refusal by the visitor stays quiet. Per-event lines, every mapped event and every drop, still need `debug: true`.
