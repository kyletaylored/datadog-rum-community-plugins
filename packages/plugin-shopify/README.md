# `@kyletaylored/datadog-rum-plugin-shopify`

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

Checkout events, order value and customer identity from Shopify Web Pixels.

## It composes with the official plugin, it does not replace it

Datadog ships [`@datadog/browser-rum-shopify`](https://github.com/DataDog/browser-sdk/tree/main/packages/browser-rum-shopify).
Its `shopifyPlugin` makes the SDK work inside the Web Pixel sandbox — it patches the sandboxed
iframe's APIs and turns off replay, resources, long tasks and auto-tracked interactions — and binds
`page_viewed`, `clicked` and `ui_extension_errored`. What it does not do is subscribe to
`checkout_completed`, cart events or customer data, so order count, revenue and `setUser` stay as
copy-paste examples in the docs.

This adapter fills exactly that gap. **It subscribes only to the events the official plugin leaves
alone**, so both can read the same `analytics` global with no overlap, and it never touches
`initConfiguration` — the official plugin owns that.

```js
// Settings > Customer events > custom pixel
DD_RUM.init({
  /* ... */
  plugins: [
    DD_RUM.shopifyPlugin({ shopifyAnalytics: analytics }), // official: sandbox fixes, views, clicks, extension errors
    DD_RUM_PLUGINS['shopify']({ analytics }),              // community: checkout events, order value, setUser
  ],
})
```

npm, for a build that bundles both:

```js
import { datadogRum } from '@datadog/browser-rum'
import { shopifyPlugin as officialShopifyPlugin } from '@datadog/browser-rum-shopify'
import { shopifyPlugin } from '@kyletaylored/datadog-rum-plugin-shopify'

datadogRum.init({
  applicationId, clientToken, site, service, env, version,
  plugins: [
    officialShopifyPlugin({ shopifyAnalytics: analytics }),
    shopifyPlugin({ analytics }),
  ],
})
```

Without `analytics`, this adapter **opts out** (`onInit` returns `false`) rather than initializing
and silently sending nothing, the same way the official plugin opts out off a checkout page. A
misconfigured install looks misconfigured.

## Events it subscribes to

`collection_viewed`, `product_viewed`, `product_added_to_cart`, `product_removed_from_cart`,
`cart_viewed`, `checkout_started`, `checkout_shipping_info_submitted`, `payment_info_submitted`,
`checkout_completed`, `search_submitted`.

Shopify events with no GA4 equivalent send no action. `checkout_contact_info_submitted`, for
instance, only feeds `setUser` when the merchant opts into email.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `analytics` | none | **Required.** The sandbox `analytics` global, the same object the official plugin takes as `shopifyAnalytics` |
| `events` | all | Allow-list of commerce actions |
| `identifyUsers` | `true` | Call `setUser` with the Shopify customer ID from `checkout_completed` |
| `includeEmail` / `includeName` | `false` | Add PII to `setUser` |
| `includeItems` | `false` | Attach `items[]`, capped at 20 entries |
| `actionPrefix` | `'commerce.'` | Rename the commerce prefix |
| `consent` | `'auto'` | Reads the Shopify Customer Privacy API; `ignore` defers to the host page |
| `beforeTrack` | none | Edit or drop an event before it is sent |
| `debug` | `false` | Log every mapped event to the console |

## Consent

With `consent: 'auto'` the adapter reads `window.Shopify.customerPrivacy.analyticsProcessingAllowed()`:

- `false` → nothing is sent.
- `true` → events flow, and the accepted categories are reported.
- **absent** → events flow. Inside the pixel sandbox there is no Customer Privacy API, because the
  Pixel Manager has already applied the merchant's consent categories before the pixel runs at all.

## Mapping details worth knowing

- **`transaction_id`** is `order.id`, falling back to the checkout token on stores where `order` is not populated on `checkout_completed`. The purchase fires once per ID, so a refreshed thank-you page does not double-count — the fixtures replay `checkout_completed` twice to prove it.
- **`payment_type`** is the gateway or payment-method name only. Shopify does not send card data, and the core strips card fields regardless; the fixtures include a `card_number` on the payment step to prove the stripping runs.
- **`item_variant`** drops Shopify's `"Default Title"` placeholder, which is noise rather than a variant.
- **`search_term_length`** only. The query text never leaves the browser.
- The customer is identified **before** the purchase action, so the order lands on an identified session.

## What it touches

| | |
| --- | --- |
| Platform globals read | `analytics` (Web Pixel sandbox), `window.Shopify` |
| Platform events subscribed | the ten listed above |
| Storage keys written | `dd_rum_commerce_seen` (the core's purchase dedupe) |
| RUM APIs called | `addAction`, `setGlobalContextProperty`, `setUser`, `setTrackingConsent` |
| Consent source | Shopify Customer Privacy API |

## Events this plugin sends

Generated from the fixture run, in
[`fixtures/.generated/events.json`](fixtures/.generated/events.json) and on the plugin's gallery
page. Never written by hand.
