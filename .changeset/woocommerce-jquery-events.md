---
'@kyletaylored/datadog-rum-plugin-woocommerce': patch
---

Hear classic themes. WooCommerce's classic add-to-cart script raises `added_to_cart` and `removed_from_cart` with jQuery's `trigger()`, which never reaches a native listener, so on a classic theme those adds and removes were not seen. When the page has `window.jQuery`, the plugin now also listens through it and reads the product from the button Woo passes (`data-product_id`, `data-product_sku`, `data-quantity`). That event carries no price, so no `value` is sent.

A native add or remove that carries no cart and no product is now skipped. That is what the block scripts re-dispatch for a jQuery add, so one add is not counted twice. It also removes an empty `add_to_cart` that was sent before.
