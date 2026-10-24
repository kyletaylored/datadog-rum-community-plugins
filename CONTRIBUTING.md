# Contributing

An adapter is a small module: subscribe to the platform's own events, map them onto the shared
schema, call the RUM public API. The core handles dedupe, the consent gate, the PII and payment
filter, size caps and the debug log, so you write none of that.

The full guide — including the rules that will fail a PR — is at
[`/docs/contributing/`](site/src/pages/docs/contributing.astro) on the project site. The short
version:

```bash
git clone https://github.com/kyletaylored/datadog-rum-community-plugins
cd datadog-rum-community-plugins
npm install
npm run new-plugin -- bigcommerce --title "BigCommerce" --family commerce --github your-handle
npm run verify
```

## Before you open a PR

- `npm run verify` passes: build, unit and conformance tests, manifest validation, size budget.
- `npx vitest run --project browser` passes if you changed the core or anything touching the plugin contract. It needs `npx playwright install chromium` once.
- Your fixtures are real recorded payloads, with a note saying where they came from, and at least one carries something that must be stripped so the privacy rules are exercised.
- `plugin.json` matches the code: `exportName`, `actions`, `options` and `footprint`.
- You added a changeset: `npm run changeset`.

## Things that are already decided

See [`AGENTS.md`](AGENTS.md). Don't reopen them without asking: the npm scope, GA4-derived event
names, keeping store currency with no browser-side conversion, composing with Datadog's official
Shopify plugin rather than forking it, and client-side-only capture.

## Schema changes

Changing `packages/core/src/schema` affects every adapter and every dashboard built on it. It needs
a short RFC in an issue, a semver bump, and both halves of the schema updated together — the
runtime registry and the full spec, which `schema.test.ts` holds in agreement.

## Reporting a privacy problem

If you find data leaving the browser that shouldn't, open a security advisory on the repository
rather than a public issue, and include the platform payload that triggers it.
