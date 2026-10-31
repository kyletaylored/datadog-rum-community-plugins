# `@kyletaylored/datadog-rum-plugin-__NAME__`

> A personal community project under [@kyletaylored](https://github.com/kyletaylored). **Not provided or supported by Datadog.**

One or two sentences: what this adapter reads from __TITLE__, and what it sends to Datadog RUM.

## Install

### npm

```js
import { datadogRum } from '@datadog/browser-rum'
import { __NAME_FN__Plugin } from '@kyletaylored/datadog-rum-plugin-__NAME__'

datadogRum.init({
  applicationId, clientToken, site, service, env, version,
  plugins: [__NAME_FN__Plugin()],
})
```

### CDN

Always an exact version with an SRI hash. There is no auto-updating `latest` URL; pin a version.

```html
<script src="https://www.datadoghq-browser-agent.com/<site>/v7/datadog-rum.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kyletaylored/datadog-rum-plugin-__NAME__@0.1.0/dist/plugin.js"
        integrity="sha384-REPLACE_WITH_THE_HASH_FROM_THE_RELEASE" crossorigin="anonymous"></script>
<script>
  DD_RUM.init({ /* ... */, plugins: [DD_RUM_PLUGINS.__NAME__()] })
</script>
```

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `events` | all | Allow-list of actions, with or without the prefix |
| `identifyUsers` | `true` | Call `setUser` with the platform customer ID |
| `includeEmail` / `includeName` | `false` | Add PII to `setUser` |
| `includeItems` | `false` | Attach `items[]`, capped at 20 entries |
| `actionPrefix` | `commerce.` | Rename the commerce prefix. Other families keep their own |
| `consent` | `auto` | Read the platform consent signal; `ignore`, or a resolver callback |
| `beforeTrack` | none | Edit or drop an event before it is sent |
| `debug` | `false` | Log every mapped event to the console |

## Events this plugin sends

Generated from the fixture snapshots, never written by hand. Run `npm run gen:schema-docs` after
changing a mapping.

## What it touches

Its declared footprint, also printed in debug mode and shown as a permissions list on the
plugin's gallery page.

| | |
| --- | --- |
| Platform globals read | `window.replaceMe` |
| Platform events subscribed | `replace_me` |
| Storage keys written | `dd_rum_commerce_seen` (the core's purchase dedupe) |
| RUM APIs called | `addAction`, `setGlobalContextProperty` |
| Consent source | none |

## Privacy

The core enforces these for every adapter, so this one does not reimplement them:

- No payment data, ever. Card fields are stripped even if the platform payload carries them.
- Email, name, phone and address are opt-in. `usr.id` is the platform customer ID.
- Search terms are sent as `search_term_length`, never the text.
- `items[]` is capped at 20 entries and strings at 256 characters.
- `commerce.purchase` fires once per `transaction_id`, deduplicated for 24 hours.
- Nothing is sent before consent when a consent source is present.
