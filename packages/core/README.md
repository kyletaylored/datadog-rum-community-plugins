# `@kyletaylored/datadog-rum-community-plugins`

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

The shared core behind the community RUM plugins. Adapters depend on it; sites normally don't
install it directly.

It holds two things: the versioned event schemas, and the safety layers every adapter inherits so
no adapter has to reimplement them.

## What the core does, so adapters don't

An adapter's only job is to map its platform's events onto the shared schema. Everything below
happens in `createTracker`:

| | |
| --- | --- |
| **Event allow-list** | Rejects anything outside the schema, and honours the install's `events` option |
| **Consent gate** | Holds every event, `setUser` included, until consent is granted. Nothing is queued |
| **PII and payment filter** | Strips card fields, CVV, addresses, email, phone, free text and search terms from every attribute object, at any nesting depth |
| **Size caps** | `items[]` to 20 entries, strings to 256 characters, objects to four levels |
| **Purchase dedupe** | One `commerce.purchase` per `transaction_id` per browser, for 24 hours |
| **`beforeTrack` hook** | Lets the site edit or drop an event — and re-filters afterwards, so the hook cannot reintroduce a blocked key |
| **Debug log** | Prints every mapped event and the adapter's declared footprint |

## Usage in an adapter

```ts
import { createTracker, type RumPlugin } from '@kyletaylored/datadog-rum-community-plugins'

export function examplePlugin(options: ExampleOptions = {}): RumPlugin {
  return {
    name: 'example',
    onInit({ initConfiguration, publicApi }) {
      const tracker = createTracker({
        platform: 'example',
        version: PLUGIN_VERSION,
        publicApi,
        initConfiguration,
        options,
        footprint: FOOTPRINT,
      })

      tracker.setStore({ id: shopId, currency: 'USD', locale: 'en-US' })
      tracker.identify({ id: customerId, email, name }) // the core decides what is sent
      tracker.track('add_to_cart', { value: 28, currency: 'USD', items })
    },
  }
}
```

Pass `email` and `name` straight through rather than gating them yourself: the core applies
`includeEmail` and `includeName`, and doing it in two places is how one of them ends up wrong.

## The plugin contract

`RumPlugin` lives in `@datadog/browser-rum-core`, which is internal to the SDK and may change
without notice. [`src/types.ts`](src/types.ts) declares that shape structurally and is the only
place in the repo that depends on it, so an upstream break is one edit rather than one per adapter.

Adapters call only the `publicApi` methods and never `datadogRum.init`. `@datadog/browser-rum` is a
peer dependency with a deliberately narrow range, and a weekly CI job runs the real-SDK integration
test against the latest release.

## Schema

`SCHEMA_VERSION` is bumped by RFC; adapters declare the version they emit in `plugin.json`.

The schema is split in two on purpose:

- **`schema/registry.ts`** — the runtime slice: event names, family prefixes, context keys. This is
  what the tracker imports, and the only part that reaches a merchant's page.
- **`schema/index.ts` and `schema/attributes.ts`** — the full specs with GA4 mappings, descriptions
  and examples, for the docs site and the conformance suite.

They are separate because the CDN build has a 5 KB gzip budget and the metadata is dead weight at
runtime. `schema.test.ts` asserts the two stay in agreement, so the split cannot silently drift.

## Exports

| Export | For |
| --- | --- |
| `createTracker` | Building an adapter |
| `createConsentGate` | A consent adapter that emits no actions of its own |
| `createDedupe`, `DEDUPE_STORAGE_KEY`, `DEDUPE_TTL_MS` | Tests, and adapters needing a second dedupe namespace |
| `sanitizeContext`, `sanitizeItems`, `isBlockedKey`, `money`, `count`, `text` | Mapping helpers; `money` rounds to cents so floating-point noise never reaches a distribution metric |
| `FAMILIES`, `COMMERCE`, `ACCOUNT`, `LEAD`, `SUPPORT`, `allActionNames()` | Docs generation and the conformance suite |
| `GLOBAL_CONTEXT_KEYS`, `SCHEMA_VERSION`, `MAX_ITEMS`, `MAX_STRING_LENGTH` | Both |
| `PluginManifest`, `PluginFootprint`, `RumPlugin`, `RumPublicApi` | Types |

Also published: [`schema/plugin-manifest.schema.json`](schema/plugin-manifest.schema.json), the
JSON schema every `plugin.json` is validated against in CI.
