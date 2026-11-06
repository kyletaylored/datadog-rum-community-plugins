---
'@kyletaylored/datadog-rum-plugin-shopify': minor
---

Storefront mode: the plugin now reports cart and browsing events when it runs outside a Web Pixel, as it does in a theme snippet, a tag manager or the RUM Injector. Before, every event came from `analytics.subscribe`, which only exists inside a pixel, so such an install collected nothing.

With no `analytics` passed (or `mode: 'storefront'`), it reads:

- `view_item`, `view_item_list`, `search` (length only) and the signed-in customer ID from `ShopifyAnalytics.meta`, which every Online Store theme prints;
- `add_to_cart` and `remove_from_cart` by diffing `cart.js` snapshots. Resource timing notices the theme's cart requests by URL, and the plugin makes one tagged read of its own. `fetch` and XHR are never patched;
- `view_cart` on the cart page, and `begin_checkout` on a click on a checkout control.

Cart `attributes`, the note, line `properties` and the cart key are never read: on real stores they hold the shopper's email and app tokens. The cart snapshot is kept in `sessionStorage` as `dd_rum_shopify_cart`. Payment and purchase still need the pixel install.

The CDN bundle now has a declared 6 KB budget, since it carries both adapters.
