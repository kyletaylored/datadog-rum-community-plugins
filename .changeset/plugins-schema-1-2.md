---
'@kyletaylored/datadog-rum-plugin-engagement': patch
'@kyletaylored/datadog-rum-plugin-onetrust': patch
'@kyletaylored/datadog-rum-plugin-shopify': patch
'@kyletaylored/datadog-rum-plugin-woocommerce': patch
---

Emit schema 1.2.0 (`commerce.schema_version`). Nothing a plugin sends changes otherwise. The CDN bundles are smaller, by about 140 bytes gzipped each: every other family's event names had been leaking into every bundle through the schema spec's prefix reads, and no longer do.
