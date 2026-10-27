---
'@kyletaylored/datadog-rum-community-plugins': minor
'@kyletaylored/datadog-rum-plugin-engagement': minor
'@kyletaylored/datadog-rum-plugin-shopify': patch
'@kyletaylored/datadog-rum-plugin-woocommerce': patch
'@kyletaylored/datadog-rum-plugin-onetrust': patch
---

Adds the engagement kit, and schema 1.1.0 with the `engagement` family.

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
