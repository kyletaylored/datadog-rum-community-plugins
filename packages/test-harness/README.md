# `@kyletaylored/datadog-rum-test-harness`

Private; not published. Every adapter tests against it.

## What it gives an adapter

| Export | What it does |
| --- | --- |
| `createFakeRum()` | A `publicApi` that records calls instead of sending them, with helpers for actions, global context and the set of APIs touched |
| `loadFixtures(dir)` | Reads `fixtures/*.json` in order — order matters for dedupe and consent cases |
| `runFixtures` / `runConformance` | Initialize an adapter, replay fixtures, run the suite |
| `checkConformance(...)`, `formatFindings(...)` | The shared suite; `formatFindings` turns findings into one readable assertion message |
| `installMemoryLocalStorage()` | Node has `EventTarget` and `CustomEvent` but no `localStorage`; without this the purchase dedupe silently falls back to a per-instance memory set and a reload test cannot tell real deduplication from that fallback |
| `createMemoryStorage()` | An in-memory `Storage` to inject directly |
| `interceptIntake()` | Patches `fetch` and `sendBeacon`, parses the SDK's newline-delimited intake batches, and exposes the custom actions inside them |
| `writeEventReport(...)` | Writes `fixtures/.generated/events.json` during the fixture run; the site's "Events this plugin sends" reads it |

## What the conformance suite checks

Every adapter runs it with no extra code:

- Action names are in the schema, with the right family prefix. Renaming `commerce.` must not rename `account.login`.
- Attribute names and types match the schema. Numbers must be numbers, not numeric strings, or they cannot become RUM measures.
- No blocked key reaches `addAction` or `setUser`, at any depth.
- Email and name appear only when opted in.
- `items[]` is opt-in, capped at 20, and carries only GA4 item fields.
- Strings are within the 256-character cap.
- One `commerce.purchase` per `transaction_id`, and none without one.
- Nothing is sent before consent, when the manifest declares a consent source.
- The manifest's declared footprint covers every RUM API the run actually called.
- The manifest's schema version matches what the core ships.

## Fixtures reach the adapter through its own subscription

`runFixtures` hands each payload to the platform double the adapter subscribed to, rather than
calling the mapping function directly. Testing the mapper alone would skip the subscription wiring,
which is the part most likely to be wrong.

## Generated event reports are read-only in CI

With `CI=true`, `writeEventReport` compares instead of writing and throws when the committed file
is stale. A mapping change without a regenerated report fails the build rather than shipping docs
that describe the old behaviour.
