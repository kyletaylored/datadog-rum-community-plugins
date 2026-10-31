# Datadog RUM Community Plugins

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

Custom RUM events, without the custom code.

Scroll depth, file downloads, video plays, newsletter signups, logins, orders — captured as Datadog
RUM actions and metrics from one script tag. Nothing to instrument, no data layer to design.

The Browser RUM SDK collects sessions, views, errors and long tasks on its own. What a visitor
actually *did* does not come for free: it needs hand-written `addAction`, `setUser` and
`setGlobalContextProperty` calls, which many teams on managed platforms cannot ship at all.

Events use [GA4's names and parameters](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
behind a family prefix, so a marketing or product team arriving from GA4, Matomo or Plausible
recognises them on sight.

**Status: Phase 0.** The core, the harness, four plugins, the asset pack, the build and release
pipeline, the site and a demo site per plugin are in place. Nothing is published to npm yet.

**[Try the sandbox](https://kyletaylored.github.io/datadog-rum-community-plugins/sandbox/)** — a
shopper clicks through a store and you watch exactly what the plugin sends, and what it refuses to
send. Runs the real plugin in your browser; no Datadog account, and it never asks for an application
ID or client token.

## Install

A script tag, because most of these sites cannot run a build. Consent plugins go first, so nothing
is collected before the visitor accepts.

```html
<script src="https://www.datadoghq-browser-agent.com/us1/v6/datadog-rum.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kyletaylored/datadog-rum-plugin-onetrust@0.1.0/dist/plugin.js"
        integrity="sha384-REPLACE_FROM_RELEASE" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/@kyletaylored/datadog-rum-plugin-woocommerce@0.1.0/dist/plugin.js"
        integrity="sha384-REPLACE_FROM_RELEASE" crossorigin="anonymous"></script>
<script>
  window.DD_RUM.init({
    applicationId: 'YOUR_APPLICATION_ID',
    clientToken: 'YOUR_CLIENT_TOKEN',
    site: 'datadoghq.com',
    plugins: [
      window.DD_RUM_PLUGINS['onetrust']({ category: 'C0002' }),
      window.DD_RUM_PLUGINS['woocommerce'](),
    ],
  })
</script>
```

Versions are pinned and each tag carries an SRI hash; there is no `latest` URL. npm works too:

```js
import { wooCommercePlugin } from '@kyletaylored/datadog-rum-plugin-woocommerce'
datadogRum.init({ /* ... */, plugins: [wooCommercePlugin()] })
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
| [`@kyletaylored/datadog-rum-plugin-engagement`](packages/plugin-engagement) | **The generic kit.** Scroll depth, downloads, outbound and contact clicks, video, forms — any site, zero config | 5.15 KB |
| [`@kyletaylored/datadog-rum-plugin-shopify`](packages/plugin-shopify) | Checkout events, order value and identity from Web Pixels | 4.99 KB |
| [`@kyletaylored/datadog-rum-plugin-woocommerce`](packages/plugin-woocommerce) | Cart, checkout and order events from Woo's DOM events | 4.66 KB |
| [`@kyletaylored/datadog-rum-plugin-onetrust`](packages/plugin-onetrust) | Holds RUM until the OneTrust analytics category is accepted | 1.65 KB |

CI enforces a 5 KB gzip budget per plugin; the engagement kit declares 6 KB, because it is five
trackers rather than an event mapper. See `BUDGET_OVERRIDES_KB` in `scripts/size-check.mjs`.

## The event model

Action names are [GA4's recommended ecommerce event names](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
behind a family prefix, and attributes are GA4's parameters. There is no second vocabulary, and a
site already pushing GA4 ecommerce data maps one to one.

```
engagement.scroll         engagement.video_start      engagement.form_start
engagement.click          engagement.video_progress   engagement.form_submit
engagement.file_download  engagement.video_complete

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
| `npm run site:dev` | The project site, with the gallery and sandbox generated from the packages |
| `npm run site:build` | Builds the site. Separate from `npm run build`, which builds only the packages |
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
