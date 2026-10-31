# `@kyletaylored/datadog-rum-plugin-engagement`

> A personal community project under [@kyletaylored](https://github.com/kyletaylored), MIT licensed.
> **Not provided or supported by Datadog.**

The generic kit: the events an analytics tool captures automatically, with no instrumentation.

Scroll depth, outbound and contact clicks, file downloads, video plays, form starts and
submissions — mapped onto the shared schema using GA4's event names, so a team arriving from GA4,
Matomo or Plausible already knows what everything is called.

It reads nothing platform-specific, so it runs alongside a commerce or consent plugin rather than
instead of one.

## Install

```html
<script src="https://www.datadoghq-browser-agent.com/us1/v7/datadog-rum.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kyletaylored/datadog-rum-plugin-engagement@0.1.0/dist/plugin.js"
        integrity="sha384-REPLACE_FROM_RELEASE" crossorigin="anonymous"></script>
<script>
  window.DD_RUM.init({
    applicationId: 'YOUR_APPLICATION_ID',
    clientToken: 'YOUR_CLIENT_TOKEN',
    site: 'datadoghq.com',
    plugins: [window.DD_RUM_PLUGINS['engagement']()],
  })
</script>
```

```js
import { engagementPlugin } from '@kyletaylored/datadog-rum-plugin-engagement'
datadogRum.init({ /* ... */, plugins: [engagementPlugin()] })
```

Zero configuration. Every tracker is on by default.

## What it sends

| Action | Fires when | Key attributes |
| --- | --- | --- |
| `engagement.scroll` | 25, 50, 75 and 90% depth, once each per view | `percent_scrolled` |
| `engagement.click` | An outbound, `mailto:` or `tel:` link is clicked | `link_type`, `outbound`, `link_domain`, `link_path`, `link_text` |
| `engagement.file_download` | A link to a document, archive or media file | `file_name`, `file_extension`, `link_domain` |
| `engagement.video_start` | A video begins playing | `video_title`, `video_provider`, `video_duration` |
| `engagement.video_progress` | 10, 25, 50 and 75% watched | `video_percent`, `video_title` |
| `engagement.video_complete` | A video reaches the end | `video_title` |
| `engagement.form_start` | First interaction with a form | `form_id`, `form_name` |
| `engagement.form_submit` | A form is submitted | `form_id`, `form_name`, `form_destination` |
| `lead.generate_lead` | A form marked as a lead is submitted | `form_id`, `form_name` |

Internal links send nothing: a same-site navigation is already a RUM view, and reporting it again
as an action is noise.

### Newsletter signups and other leads

Mark the form, and its submission also counts as a lead:

```html
<form id="newsletter" data-lead aria-label="Newsletter signup">…</form>
```

Opt-in by selector rather than guessed from field names — guessing would mean reading the fields.
Change the selector with `leadFormSelector`.

## What it will never send

This plugin touches links, forms and media, which is exactly where personal data lives. Three
things are therefore true by construction, not by configuration:

- **No URLs.** GA4 sends `link_url`. A URL can carry a session token, a reset code or an email in
  its query string, so this sends `link_domain` and `link_path` — host and path, query and fragment
  dropped.
- **No addresses.** A `mailto:` or `tel:` href *is* the personal data. Those clicks report
  `link_type: 'email'` or `'phone'` and nothing else.
- **No field values.** Not on start, not on submit, not ever. A form's identity and destination
  host are read; no input is touched.

The fixtures deliberately include an access token in a query string, a mailto address, a phone
number, a populated password field and a search box with text in it, so these are exercised rather
than asserted.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `scrollThresholds` | `[25, 50, 75, 90]` | Depth percentages, each firing once per view |
| `videoThresholds` | `[10, 25, 50, 75]` | Progress percentages |
| `downloadExtensions` | 11 common formats | Extensions treated as a download |
| `leadFormSelector` | `[data-dd-lead], form[data-lead]` | Forms that also emit `lead.generate_lead` |
| `trackScroll` / `trackClicks` / `trackDownloads` / `trackVideo` / `trackForms` | `true` | Turn a tracker off |
| `consent` | `auto` | Holds everything until consent is granted; `ignore` defers to the page |
| `beforeTrack` | none | Edit or drop an event before it is sent |
| `debug` | `false` | Log every mapped event to the console |

## Known limits

- **Video is HTML5 `<video>` only.** YouTube and Vimeo embeds are iframes and need their player
  APIs; `video_provider` exists so they can be added without a schema change.
- **Scroll thresholds reset on `popstate`, not on a `pushState` route change.** Observing that
  means patching `history`, which this plugin will not do to a merchant's page. A single-page app
  should reset them itself on navigation.
- **Scroll is measured against document height**, so a page whose main content scrolls inside a
  container reports 100% immediately.

## What it touches

| | |
| --- | --- |
| Globals read | `document`, `window` |
| Events subscribed | `scroll`, `click`, `play`, `timeupdate`, `ended`, `focusin`, `submit`, `popstate` |
| Storage keys written | none |
| RUM APIs called | `addAction`, `setGlobalContextProperty` |
| Consent source | none — pair it with a consent plugin |

Scroll measurement is coalesced into one animation frame, so a fast scroll does not turn the
listener into the thing slowing the page down.
