---
'@kyletaylored/datadog-rum-plugin-woocommerce': minor
---

Expose the checkout reporter on the CDN bundle as `window.DD_RUM_PLUGINS.woocommerce.createCheckoutReporter`, so a page without a bundler can report `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info` and `search`. `createCheckoutReporter` now also takes the plugin instance passed to `init`, resolving its tracker once `init` has run; a step reported before then is dropped with a console warning. Passing a tracker still works.
