# `@kyletaylored/datadog-rum-plugin-shopify`

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

Checkout events, order value and customer identity from Shopify Web Pixels, and cart and
browsing events from the storefront itself when it runs outside a pixel.

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

## Storefront mode: outside the pixel

Installed in a theme, through a tag manager or by an injector, the plugin has no pixel `analytics`
to subscribe to. With no `analytics` passed it switches to **storefront mode**, which reads what
every Online Store theme exposes to any script:

| Event | Where it comes from |
| --- | --- |
| `view_item` | `ShopifyAnalytics.meta.product` on a product page (the `?variant=` in the URL picks the variant) |
| `view_item_list` | `ShopifyAnalytics.meta.products` on a collection page |
| `search` | the length of the `q` URL parameter on the search page, never the text |
| `add_to_cart` / `remove_from_cart` | the difference between two `cart.js` snapshots |
| `view_cart` | `cart.js` on the cart page |
| `begin_checkout` | a click on a control named `checkout` or a link to `/checkout`, valued from the last cart snapshot |
| `setUser` | `ShopifyAnalytics.meta.page.customerId` when signed in, ID only |

**How cart changes are seen.** A theme reads `cart.js` around every change, but neither response
names the line that changed; the difference between them does. The plugin watches resource timing
for the theme's cart requests (`/cart.js`, `/cart/add`, `/cart/change`, `/cart/update`, by URL
only), waits for the burst to settle, reads `cart.js` once itself (`?dd_rum=1`, so it never counts
its own read), and compares it with the last snapshot. That works whichever way the theme changes
the cart. **Nothing on the page is patched:** not `fetch`, not XHR, not the theme. The cost is one
same-origin GET per cart change, plus one at the start of a session for a baseline. The snapshot
is kept in `sessionStorage` (`dd_rum_shopify_cart`) so a change on the next page still has one.

**What it never reads.** `cart.js` also carries cart `attributes` (on real stores: the shopper's
email address and app tokens), the order `note`, line `properties` (personalisation text) and the
product description. None is read or stored. The cart token is sent as `cart_id` without its
`?key=` half, which is a credential for the cart.

**What stays pixel-only.** Shipping, payment and the order happen inside Shopify's checkout, which
a storefront script cannot see. `add_shipping_info`, `add_payment_info` and `purchase` need the
pixel install above.

Force a mode with `mode: 'pixel'` or `mode: 'storefront'`.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `analytics` | none | The sandbox `analytics` global, the same object the official plugin takes as `shopifyAnalytics`. Required inside a custom pixel; without it the plugin runs storefront mode |
| `mode` | `'auto'` | `pixel` subscribes to `analytics`, `storefront` reads the theme; `auto` picks `pixel` when `analytics` is passed |
| `events` | all | Allow-list of commerce actions |
| `identifyUsers` | `true` | Call `setUser` with the Shopify customer ID from `checkout_completed` |
| `includeEmail` / `includeName` | `false` | Add PII to `setUser` |
| `includeItems` | `false` | Attach `items[]`, capped at 20 entries |
| `actionPrefix` | `'commerce.'` | Rename the commerce prefix |
| `consent` | `'auto'` | Reads the Shopify Customer Privacy API; `ignore` skips the gate |
| `beforeTrack` | none | Edit or drop an event before it is sent |
| `debug` | `false` | Log every mapped event to the console |

## Consent

With `consent: 'auto'` the adapter reads `window.Shopify.customerPrivacy.analyticsProcessingAllowed()`:

- `false` → nothing is sent.
- `true` → events flow, and the accepted categories are reported.
- **absent** → no signal is recorded and the plugin follows the page. Inside the pixel sandbox there
  is no Customer Privacy API, because the Pixel Manager has already applied the merchant's consent
  categories before the pixel runs at all.

The answer is recorded in the page-wide consent record, so a `false` also holds every other
community plugin on the page. The adapter never calls `setTrackingConsent`: it cannot release RUM
that a consent plugin such as OneTrust is holding.

The plugin never returns `false` from `onInit`, which in Browser SDK v7 would stop RUM for the
whole page. A page with neither `analytics` nor `ShopifyAnalytics` gets a console warning instead.

## Mapping details worth knowing

- **`transaction_id`** is `order.id`, falling back to the checkout token on stores where `order` is not populated on `checkout_completed`. The purchase fires once per ID, so a refreshed thank-you page does not double-count — the fixtures replay `checkout_completed` twice to prove it.
- **`payment_type`** is the gateway or payment-method name only. Shopify does not send card data, and the core strips card fields regardless; the fixtures include a `card_number` on the payment step to prove the stripping runs.
- **`item_variant`** drops Shopify's `"Default Title"` placeholder, which is noise rather than a variant.
- **`search_term_length`** only. The query text never leaves the browser.
- The customer is identified **before** the purchase action, so the order lands on an identified session.

## What it touches

| | |
| --- | --- |
| Platform globals read | `analytics` (Web Pixel sandbox), `window.Shopify`, `window.ShopifyAnalytics.meta` (storefront mode) |
| Platform events subscribed | the ten listed above; in storefront mode, resource timing for cart requests and clicks on a checkout control |
| Storage keys written | `dd_rum_commerce_seen` (the core's purchase dedupe), `dd_rum_shopify_cart` (storefront mode's cart snapshot, `sessionStorage`) |
| RUM APIs called | `addAction`, `setGlobalContextProperty`, `setUser` |
| Consent source | Shopify Customer Privacy API |

## Events this plugin sends

Generated from the fixture run, in
[`fixtures/.generated/events.json`](fixtures/.generated/events.json) and on the plugin's gallery
page. Never written by hand.
