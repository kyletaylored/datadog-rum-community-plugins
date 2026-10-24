# `@kyletaylored/datadog-rum-plugin-woocommerce`

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

Cart, checkout and order events from WooCommerce's own storefront DOM events, plus the order data
printed on the order-received page.

## Install

```js
import { datadogRum } from '@datadog/browser-rum'
import { wooCommercePlugin } from '@kyletaylored/datadog-rum-plugin-woocommerce'

datadogRum.init({
  applicationId, clientToken, site, service, env, version,
  plugins: [wooCommercePlugin({ identifyUsers: true, includeItems: false })],
})
```

CDN, pinned to an exact version with its SRI hash from the release:

```html
<script src="https://www.datadoghq-browser-agent.com/<site>/v6/datadog-rum.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kyletaylored/datadog-rum-plugin-woocommerce@0.1.0/dist/plugin.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  DD_RUM.init({ /* ... */, plugins: [DD_RUM_PLUGINS['woocommerce']()] })
</script>
```

## Order data needs a server-rendered payload

**This is the one thing to get right.** WooCommerce exposes no client-side order object, so
`commerce.purchase` cannot be observed from the browser alone. The adapter reads a payload printed
on the order-received page:

```php
// Your theme or the companion WordPress plugin, on woocommerce_thankyou
wp_add_inline_script('dd-rum-woocommerce', 'window.ddRumWooCommerce = ' . wp_json_encode([
  'store'    => ['id' => $shop_host, 'currency' => get_woocommerce_currency(), 'locale' => get_locale()],
  'customer' => ['id' => $user_id, 'type' => $order_count > 1 ? 'returning' : 'new'],
  'order'    => [
    'transaction_id' => $order->get_order_number(),
    'value'          => (float) $order->get_total(),
    'currency'       => $order->get_currency(),
    'tax'            => (float) $order->get_total_tax(),
    'shipping'       => (float) $order->get_shipping_total(),
    'coupon'         => $order->get_coupon_codes()[0] ?? null,
    'item_count'     => $order->get_item_count(),
    'unique_items'   => count($order->get_items()),
    'payment_type'   => $order->get_payment_method_title(),
  ],
]), 'before');
```

Without `transaction_id` no purchase is sent at all, because revenue that cannot be deduplicated
would be counted again on every reload. Email and name may be included in that payload; they are
only sent if `includeEmail` / `includeName` are on, and the core strips anything else — the test
fixtures deliberately include a `card_number` and a `billing_address` to prove it.

## Money format

Woo's Store API sends money as integer minor units with an exponent
(`{ price: '2499', currency_minor_unit: 2 }` → 24.99); classic themes sometimes send a decimal
string instead. The adapter reads both, and values are rounded to cents so floating-point noise
never reaches a distribution metric.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `events` | all | Allow-list of commerce actions, with or without the prefix |
| `identifyUsers` | `true` | Call `setUser` with the WordPress user ID |
| `includeEmail` / `includeName` | `false` | Add PII to `setUser` |
| `includeItems` | `false` | Attach `items[]`, capped at 20 entries |
| `actionPrefix` | `'commerce.'` | Rename the commerce prefix. Other families keep their own |
| `consent` | `'auto'` | `ignore` when the host page already owns `trackingConsent`, or pass a resolver |
| `beforeTrack` | none | Edit or drop an event before it is sent |
| `dataGlobal` | `'ddRumWooCommerce'` | Where to read the server-rendered payload |
| `data` | none | Supply the payload directly, for headless setups and tests |
| `target` | `document.body` | Element the Woo block events are dispatched on |
| `debug` | `false` | Log every mapped event to the console |

## The checkout funnel

Woo's DOM events cover cart add and remove. The steps in between — `view_cart`, `begin_checkout`,
`add_shipping_info`, `add_payment_info`, `search` — have no DOM event, so `createCheckoutReporter`
exports them for a theme or the WordPress plugin to drive from the Cart and Checkout blocks' own
hooks:

```js
const reporter = createCheckoutReporter(tracker)
reporter.beginCheckout(cart)
reporter.addShippingInfo(cart, 'Ground')
reporter.search(term) // sends search_term_length only; the text never leaves the browser
```

## What it touches

| | |
| --- | --- |
| Platform globals read | `window.ddRumWooCommerce`, `window.jQuery`, `document.body` |
| Platform events subscribed | `wc-blocks_added_to_cart`, `wc-blocks_removed_from_cart`, `wc-blocks_product_list_rendered`, `added_to_cart`, `removed_from_cart` |
| Storage keys written | `dd_rum_commerce_seen` (the core's purchase dedupe) |
| RUM APIs called | `addAction`, `setGlobalContextProperty`, `setUser`, `clearUser` |
| Consent source | WP Consent API, via the `consent` option or a consent plugin |

Classic (non-block) themes are covered through the jQuery `added_to_cart` event, which carries no
cart object; the adapter falls back to the cart in `event.detail` where one is present.

## Events this plugin sends

Generated from the fixture run, in
[`fixtures/.generated/events.json`](fixtures/.generated/events.json) and on the plugin's gallery
page. Never written by hand.
