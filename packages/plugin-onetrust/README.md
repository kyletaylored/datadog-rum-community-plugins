# `@kyletaylored/datadog-rum-plugin-onetrust`

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

Holds Datadog RUM until the visitor accepts OneTrust's analytics category, then reports the
accepted categories as session context.

`onInit` sets `trackingConsent = 'not-granted'` before the SDK starts, the same way the official
`shopifyPlugin` rewrites init options. That stops RUM collecting anything at all on a page where
the banner has not been answered — not just this plugin's events. It calls
`setTrackingConsent('granted')` only once the required category is active, and `'not-granted'`
again if the visitor later withdraws.

**Put it first in `plugins: [...]`**, before any adapter that sends events.

## Install

```js
import { datadogRum } from '@datadog/browser-rum'
import { oneTrustPlugin } from '@kyletaylored/datadog-rum-plugin-onetrust'

datadogRum.init({
  applicationId, clientToken, site, service, env, version,
  plugins: [oneTrustPlugin({ category: 'C0002' })],
})
```

CDN, pinned to an exact version with its SRI hash from the release (there is no `latest` URL):

```html
<script src="https://www.datadoghq-browser-agent.com/<site>/v7/datadog-rum.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kyletaylored/datadog-rum-plugin-onetrust@0.1.0/dist/plugin.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  DD_RUM.init({ /* ... */, plugins: [DD_RUM_PLUGINS['onetrust']()] })
</script>
```

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `category` | `'C0002'` | The category that must be active before RUM may collect. Accepts an array when a site requires several; **all** of them must be active |
| `reportCategories` | `true` | Send the accepted categories as `consent.categories` |
| `timeoutMs` | `10000` | How long to wait for the banner script before warning. RUM stays held either way |
| `debug` | `false` | Log consent transitions to the console |

`C0002` is Performance in OneTrust's default category set. Sites that put analytics elsewhere
should pass their own — check the preference centre rather than assuming.

## How it detects consent

OneTrust's callback surface is not fully covered by public vendor docs, so this adapter listens on
every known path and reads the state directly as a fallback. Any one of them firing is enough:

1. `window.OnetrustActiveGroups` read on init, which covers a banner already answered before RUM loaded.
2. The `OneTrustGroupsUpdated` event on the window.
3. `window.OptanonWrapper`, **chained** rather than replaced, so a site's own wrapper keeps working — and wrapped in a try/catch, so a site wrapper that throws does not take consent handling with it.
4. `window.Optanon.OnConsentChanged`, registered once the banner script exists.

`OnetrustActiveGroups` is a comma-delimited string with leading and trailing commas
(`,C0001,C0002,`). If none of the four ever reports anything, RUM stays held: the adapter fails
closed, not open.

## What it touches

| | |
| --- | --- |
| Platform globals read | `window.OnetrustActiveGroups`, `window.Optanon`, `window.OptanonWrapper` |
| Platform events subscribed | `OneTrustGroupsUpdated`, `Optanon.OnConsentChanged`, `OptanonWrapper`, `pagehide` |
| Storage keys written | none |
| RUM APIs called | `setTrackingConsent`, `setGlobalContextProperty` |
| Consent source | OneTrust `OnetrustActiveGroups` |

## Events this plugin sends

None. A consent adapter emits no custom actions of its own.

## What this cannot measure

A declined visitor sends nothing at all, by design, so RUM cannot report opt-in rate.
`consent.categories` describes the categories of **sessions that opted in** — never the share of
visitors who did.
