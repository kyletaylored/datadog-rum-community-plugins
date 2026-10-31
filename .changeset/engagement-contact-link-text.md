---
'@kyletaylored/datadog-rum-plugin-engagement': patch
---

Drop `link_text` on a `mailto:` or `tel:` click when the visible text is the address or the number itself. Before, a link reading "sales@example.com" sent that address as its text. `video_start` is also now recorded with `video_duration` in the fixture run, as a browser reports it.
