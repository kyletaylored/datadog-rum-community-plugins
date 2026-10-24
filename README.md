# Datadog RUM community plugins

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

A library of Datadog Browser RUM plugins for commerce platforms, consent managers and login
providers. Each plugin reads the platform's own events and turns them into RUM context and custom
actions, so order count and revenue become Datadog metrics without writing tracking code.

The Browser RUM SDK collects sessions, views, errors and long tasks on its own. Who the shopper is,
which account they belong to and what was in the cart do not come for free — they need hand-written
`setUser`, `setAccount`, `setGlobalContextProperty` and `addAction` calls, which many merchants on
managed platforms cannot ship at all.

**Status: Phase 0.** The core, the harness, three adapters, the asset pack, the build and release
pipeline and the site are in place. Nothing is published to npm and the site is not deployed yet.

## Install

Consent adapters go first, so nothing is collected before the visitor accepts.

```js
import { datadogRum } from '@datadog/browser-rum'
import { oneTrustPlugin } from '@kyletaylored/datadog-rum-plugin-onetrust'
import { wooCommercePlugin } from '@kyletaylored/datadog-rum-plugin-woocommerce'

datadogRum.init({
  applicationId, clientToken, site, service, env, version,
  plugins: [
    oneTrustPlugin({ category: 'C0002' }), // holds RUM until analytics is accepted
    wooCommercePlugin({ identifyUsers: true }),
  ],
})
```

On Shopify checkout the community adapter **composes with the official plugin** rather than
replacing it. They subscribe to different events and read the same sandbox `analytics` global.

```js
// Settings > Customer events > custom pixel
DD_RUM.init({
  /* ... */
  plugins: [
    DD_RUM.shopifyPlugin({ shopifyAnalytics: analytics }), // official: sandbox fixes, views, clicks
    DD_RUM_PLUGINS['shopify']({ analytics }),              // community: checkout events, order value
  ],
})
```

## Packages

| Package | What it does | CDN gzip |
| --- | --- | --- |
| [`@kyletaylored/datadog-rum-community-plugins`](packages/core) | Shared core: schemas, dedupe, consent gate, PII filter, debug log | — |
| [`@kyletaylored/datadog-rum-plugin-shopify`](packages/plugin-shopify) | Checkout events, order value and identity from Web Pixels | 4.96 KB |
| [`@kyletaylored/datadog-rum-plugin-woocommerce`](packages/plugin-woocommerce) | Cart, checkout and order events from Woo's DOM events | 4.62 KB |
| [`@kyletaylored/datadog-rum-plugin-onetrust`](packages/plugin-onetrust) | Holds RUM until the OneTrust analytics category is accepted | 1.65 KB |

CI fails any adapter over 5 KB gzip.

## The event model

Action names are [GA4's recommended ecommerce event names](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
behind a family prefix, and attributes are GA4's parameters. There is no second vocabulary, and a
site already pushing GA4 ecommerce data maps one to one.

```
commerce.view_item_list   commerce.view_cart          commerce.add_payment_info
commerce.view_item        commerce.begin_checkout     commerce.purchase
commerce.add_to_cart      commerce.add_shipping_info  commerce.search
commerce.remove_from_cart
account.login  account.sign_up  account.logout  lead.generate_lead  support.chat_opened
```

Extensions exist only where GA4 has no field: `item_count`, `unique_items`, `cart_id`, and
`search_term_length`, which replaces GA4's `search_term` because that can hold anything a shopper
typed. The full reference is generated from the code — see `npm run gen:schema-docs`.

## Privacy

Enforced in the core for every adapter, and checked by the conformance suite:

- **No payment data, ever.** Card fields are stripped even when a platform payload carries them. The fixtures deliberately include a `card_number` so the stripping is exercised, not assumed.
- **PII off by default.** `usr.id` is the platform customer ID; email and name need an explicit opt-in. Phone and address have no opt-in at all.
- **Search terms as length only.** The text never leaves the browser.
- **`items[]` opt-in**, capped at 20 entries, strings truncated at 256 characters.
- **`commerce.purchase` fires once per `transaction_id`**, deduplicated for 24 hours.
- **Nothing before consent.** Events during a pending decision are dropped, not queued, so a later grant never backfills them.

## Repo layout

| Path | Holds |
| --- | --- |
| `packages/core` | Schemas, dedupe, consent gate, PII filter, debug log |
| `packages/plugin-<name>` | One adapter each: `src/`, `fixtures/`, `plugin.json`, `README.md` |
| `packages/test-harness` | Fake `publicApi`, fixture runner, conformance suite, intake interceptor (private) |
| `assets/` | Dashboard and monitor JSON, Terraform for the generated metrics |
| `site/` | The GitHub Pages project site |
| `templates/plugin` | Starter copied by `npm run new-plugin` |
| `docs/PRD.md` | The spec. Read it before changing anything structural |

## Development

```bash
npm install
npm run verify      # build, unit and conformance tests, manifest validation, size budget
```

| Command | What it does |
| --- | --- |
| `npm run build` | Vite library mode: ES and CJS per package, plus a self-registering IIFE for the CDN |
| `npx vitest run --project unit` | Core, mapping, fixture and conformance tests, in Node |
| `npx vitest run --project browser` | The real-SDK integration test, in headless Chromium |
| `npm run lint:manifests` | Validates every `plugin.json` against its JSON schema |
| `npm run size` | Enforces the 5 KB gzip budget per adapter |
| `npm run new-plugin -- <name>` | Scaffolds a new adapter from the template |
| `npm run site:dev` | The project site, with the gallery generated from `plugin.json` files |
| `node scripts/sri.mjs` | The exact-version CDN URLs and their SRI hashes |

### Why there are two test projects

The unit project runs everything against a fake `publicApi` — fast, and what most changes touch.
The browser project runs the real `@datadog/browser-rum` in headless Chromium with the intake
requests intercepted. That one is not optional: **the SDK never starts a session under jsdom**, so
a jsdom "integration" test would pass without a single event being sent. It is the only test that
proves the plugin contract and the consent gate against what actually leaves the browser.

A weekly workflow runs it against the latest SDK release, because the plugin type the SDK exposes
is internal and may change without notice.

## Contributing

`npm run new-plugin -- <name>` copies the template and renames everything. Record real platform
payloads into `fixtures/`, map them in `src/index.ts`, declare the footprint, and point the test's
`emit` at your platform double so fixtures reach the adapter through its own subscription. The
conformance suite then runs with no extra code from you.

See [the contributing docs](site/src/pages/docs/contributing.astro) for the rules that will fail a
PR, and [`AGENTS.md`](AGENTS.md) for the decisions that are already settled.

## License

MIT. Not affiliated with, provided by, or supported by Datadog.
