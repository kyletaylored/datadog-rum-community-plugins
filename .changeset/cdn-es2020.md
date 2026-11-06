---
'@kyletaylored/datadog-rum-plugin-engagement': patch
'@kyletaylored/datadog-rum-plugin-woocommerce': patch
'@kyletaylored/datadog-rum-plugin-learndash': patch
'@kyletaylored/datadog-rum-plugin-onetrust': patch
'@kyletaylored/datadog-rum-plugin-shopify': patch
---

Smaller CDN bundles. They now target ES2020 instead of ES2019, so optional chaining and `??` ship as written instead of downleveled. Every plugin requires Browser SDK v7, whose own CDN bundle uses both untranspiled, so no browser that can run the SDK loses support. Saves 0.25 to 0.36 KB gzip per bundle. The npm builds are unchanged.
