# Agent Guide: `datadog-rum-community-plugins`

A community-maintained library of Datadog Browser RUM plugins. Each plugin reads events from a platform (Shopify, WooCommerce, OneTrust, Auth0, …) and turns them into RUM context and custom actions, so a site gets user identity, consent handling and commerce metrics without writing custom code.

This is a **personal community project** under `@kyletaylored`, not an official Datadog product. Never present it as Datadog-provided or Datadog-supported.

**Status:** Phase 0 built, not yet released. The core, the test harness, three adapters, the asset
pack, the build and release pipeline and the site all exist and `npm run verify` passes. Nothing is
published to npm, the GitHub repo is not created, and Pages is not enabled — all of which need the
maintainer's go-ahead. The exit gate below is **not met yet**: it needs two real test stores.

---

## Source of truth

[`docs/PRD.md`](docs/PRD.md) is the spec. Read it before making changes. When code and the PRD disagree, either fix the code or update the PRD in the same change, and say which in the PR.

The PRD started as a shared Claude Doc. That copy is now a snapshot for sharing; edit `docs/PRD.md`, not the doc.

## Decisions already made

Don't reopen these without the maintainer asking.

| Topic | Decision |
| --- | --- |
| Ownership | Personal account, MIT, `0.x` versions until the schema settles. No official Datadog support. |
| Repo | `kyletaylored/datadog-rum-community-plugins`, one npm-workspaces monorepo |
| npm names | Core: `@kyletaylored/datadog-rum-community-plugins`. Each plugin: `@kyletaylored/datadog-rum-plugin-<name>`. Never `@datadog/*`. |
| CDN | jsDelivr from npm, exact version plus SRI hash. Builds register on `window.DD_RUM_PLUGINS.<name>()`. Never document an unpinned URL. |
| Event names | GA4 recommended event names behind a family prefix: `commerce.purchase`, `commerce.add_to_cart`, `account.login`, `lead.generate_lead`. No custom aliases. |
| Attributes | GA4 parameter names (`value`, `currency`, `transaction_id`, `items[]`). Extensions only where GA4 has no field (`item_count`, `unique_items`, `cart_id`, `search_term_length`). |
| Currency | Keep the store currency on every event and tag metrics by `currency`. No conversion in the browser. |
| Accuracy | Client-side and directional. Never claim to replace the platform's order reporting. No server-side or webhook capture. |
| Product Analytics | No extra work; RUM actions feed it automatically. |
| Shopify | Compose with the official `shopifyPlugin` from `@datadog/browser-rum-shopify`. Don't replace or fork it. |
| Deferred | Square Online, plugin API stability, upstreaming adapters into `browser-sdk`. See the PRD's "Decisions and open questions". |

## The plugin contract

Every plugin is a `RumPlugin` passed in `datadogRum.init({ plugins: [...] })`, the same shape the official [`shopifyPlugin.ts`](https://github.com/DataDog/browser-sdk/blob/main/packages/browser-rum-shopify/src/domain/shopifyPlugin.ts) uses:

```typescript
export function examplePlugin(options: ExampleOptions): RumPlugin {
  return {
    name: 'example',
    onInit({ initConfiguration, publicApi }) {
      // May adjust init options (consent plugins set trackingConsent = 'not-granted' here),
      // then subscribe to the platform's events and call publicApi.
    },
  }
}
```

- **Public API only.** Call only `publicApi` methods (`setUser`, `setAccount`, `clearUser`, `setGlobalContextProperty`, `addAction`, `startView`, `addError`, `setTrackingConsent`). The official package imports `RumPlugin` from `@datadog/browser-rum-core`, which is internal and may change. Keep that import in one place in the core.
- **Never initialize RUM.** The customer's `init` owns `applicationId`, sampling and privacy settings. `@datadog/browser-rum` is a peer dependency, not bundled.
- **Platform code stays in the plugin.** Dedupe, the consent gate, PII filtering and size caps belong in the core so every plugin gets them.

## Privacy rules (enforced by the conformance suite)

- Never read DOM inputs or send payment data. Strip card fields even if a platform payload includes them.
- `usr.id` is the platform's or provider's user ID. Email, name, phone and address are opt-in only.
- Send search terms as `search_term_length`, never the text.
- `items[]` is capped at 20 entries and strings at 256 characters.
- `commerce.purchase` fires once per `transaction_id`, deduplicated for 24 hours in `localStorage`.
- Nothing is sent before consent when a consent plugin is present.

## Phase 0: done in code, gate still open

From the PRD's Phases section.

- [x] Monorepo skeleton: root `package.json` with workspaces, `packages/core`, `packages/test-harness`, `templates/plugin`
- [x] Core: commerce, account, lead and consent schemas; dedupe; consent gate; PII filter; debug log
- [x] Test harness: fixture runner with a fake `publicApi`, the conformance suite, and a real-SDK integration test with intake requests intercepted
- [x] Plugins: Shopify (composed with `shopifyPlugin`), WooCommerce, OneTrust, each with recorded fixtures and a `plugin.json`
- [x] Build: Vite library mode producing ES, CJS and an IIFE for the CDN; 5 KB gzip limit per plugin
- [x] CI and release workflows (see Reference repos)
- [x] First cut of the project site (`site/`, Astro) with the gallery generated from `plugin.json` files
- [x] Asset pack in `assets/`: generated metric definitions, dashboard and monitor JSON

**Exit gate, not met:** orders and revenue match the platform admin within 5% on two test stores,
and no RUM data leaves a OneTrust page before consent. The consent half is covered by a real-browser
test that intercepts the intake; the accuracy half needs two real stores and seven days, which no
test can stand in for.

### Things Phase 0 settled that the PRD left open

- **The real-SDK integration test needs a real browser.** Under jsdom the Browser RUM SDK never starts a session, so nothing reaches the intake and such a test would pass without sending anything. It runs in headless Chromium via Vitest browser mode (`--project browser`); `--project unit` is everything else.
- **The schema is split in two.** `schema/registry.ts` is the runtime slice the tracker imports; `schema/index.ts` and `attributes.ts` carry the GA4 mappings, descriptions and examples for the docs and the conformance suite. Without the split the metadata lands in every CDN bundle and the 5 KB budget is unreachable. `schema.test.ts` holds the two in agreement.
- **`exportName` is in `plugin.json`.** It cannot be derived from the slug (`woocommerce` exports `wooCommercePlugin`), and the site's install snippets use it verbatim, so the validator checks it against the source.
- **Identity is gated by consent too**, not just actions. `setUser` attaches identity to the session, so it is held exactly like an `addAction`.
- **WooCommerce cannot report orders from the browser alone.** `commerce.purchase` needs a payload rendered on the order-received page; without a `transaction_id` no purchase is sent at all, because revenue that cannot be deduplicated would be recounted on every reload.
- **Shopify opts out when `analytics` is missing**, the way the official plugin does off a checkout page, so a misconfigured install looks misconfigured instead of silently sending nothing.
- **`fixtures/.generated/events.json` is committed.** The adapter's own snapshot test writes it, the site renders it, and `CI=true` makes it read-only so a mapping change without a regenerated report fails the build.

### Watch items

- **The Shopify adapter is at 4.96 KB against the 5 KB gzip budget.** The next mapping added to it will need the budget revisited or the adapter trimmed; `npm run size` is the check.
- **OneTrust's callback names are still unconfirmed against vendor docs**, as the PRD flagged. The adapter listens on all four known signals and reads the state directly as a fallback, so one firing is enough — but this should still be checked against OneTrust's own documentation.

## Reference repos

| Path or URL | Use it for |
| --- | --- |
| `~/server/github/datadog-rum-interceptor` | Build, test and release pattern: `package.json` exports, `vite.config.*.js`, `vitest.config.js`, `.github/workflows/ci.yml` and `publish.yml`, `.github/dependabot.yml`. Copy its conventions (SHA-pinned actions, `persist-credentials: false`, `npm audit`, `npm pack --dry-run`, `--provenance`), but use Changesets for multi-package releases. |
| [`browser-sdk/packages/browser-rum-shopify`](https://github.com/DataDog/browser-sdk/tree/main/packages/browser-rum-shopify) | The plugin contract and the Shopify checkout sandbox handling. The GitHub API needs SSO for the DataDog org; read files through `raw.githubusercontent.com`. |
| `~/server/scripts/datadog-rum-pizza-builder` | The RUM playground site. Live demos for these plugins go there as a new lab, after the packages are published. Its `consent-lab` is the natural demo for the consent plugins. |

## General guidelines

- **Measure, don't assert.** Docs and the site show what a plugin actually sends. "Events this plugin sends" is generated from fixture snapshots, never hand-written.
- **Pin everything.** Exact versions in CDN snippets, SHA-pinned GitHub Actions, a narrow `@datadog/browser-rum` peer range.
- **Relative paths on the site.** It's served from `/datadog-rum-community-plugins/`.
- **Never commit credentials.** No application IDs, client tokens or npm tokens in the repo. The site's snippet builder never asks for them.
- **Ask before anything public.** Creating the GitHub repo, pushing, publishing to npm and enabling Pages all need the maintainer's go-ahead.
