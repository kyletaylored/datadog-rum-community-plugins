# Security and privacy reporting

This is a personal community project under [@kyletaylored](https://github.com/kyletaylored),
maintained best effort. **It is not provided or supported by Datadog**, so please do not route
reports about it through Datadog support.

## What to report privately

Open a [security advisory](https://github.com/kyletaylored/datadog-rum-community-plugins/security/advisories/new)
rather than a public issue for:

- **Data leaving the browser that should not.** Card fields, CVV, billing addresses, email, phone, a
  search query's text — anything the privacy rules say is stripped or opt-in. This is the most
  important category: these plugins run on checkout pages.
- **A bypass of the consent gate**, where events reach the intake before the visitor accepts.
- **A supply-chain problem**: a compromised published artifact, a bad SRI hash, a malicious
  dependency, or anything that would let an attacker serve different code from a pinned CDN URL.
- **Anything that lets an adapter send to a destination other than the customer's own RUM intake.**

Include the platform payload that triggers it, **redacted** — remove real emails, names, addresses
and card data before attaching anything.

## What belongs in a public issue instead

A wrong mapping, a missing event, a value that undercounts, or a platform the adapter does not
handle. Those are correctness bugs, not security problems.

## Supported versions

`0.x` while the schema settles. Fixes land on the latest minor only; there are no backports.

## What is already enforced

These are properties of the shared core, not of individual adapters, and the conformance suite
fails a release that breaks one:

- Card fields, CVV and addresses are stripped from every attribute object at any nesting depth,
  even when a platform payload carries them.
- Email, name, phone and address are opt-in; `usr.id` is the platform customer ID.
- Search terms are sent as a length only.
- Nothing is sent before consent, and pending-decision events are dropped rather than queued, so a
  later grant never backfills them.
- A `beforeTrack` hook cannot reintroduce a blocked attribute: the output is re-filtered.

## Supply chain

- Packages publish from CI only, with npm provenance. No local publishes.
- CDN URLs are exact-version jsDelivr links with an SRI hash. There is no auto-updating `latest`
  URL, and merchants pin a version.
- GitHub Actions are pinned by commit SHA, and workflows run with `persist-credentials: false`.
- A new runtime dependency on an adapter needs core-maintainer review. The launch adapters have
  none beyond the shared core.
