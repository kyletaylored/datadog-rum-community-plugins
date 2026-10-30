## What this changes

<!-- One or two sentences. If it adds or changes a mapping, say which platform event maps to which
     schema action. -->

## Type

- [ ] New adapter
- [ ] Adapter fix or new mapping
- [ ] Core change (affects every adapter)
- [ ] Schema change (needs an RFC issue and a semver bump)
- [ ] Docs, site, or tooling

## Checks

- [ ] `npm run verify` passes (build, unit and conformance tests, manifest validation, size budget)
- [ ] `npx vitest run --project browser` passes, if this touches the core or the plugin contract
- [ ] A changeset is included (`npm run changeset`), unless this is docs or tooling only
- [ ] `plugin.json` matches the code: `exportName`, `actions`, `options`, `footprint`
- [ ] Screenshots are attached, if this changes how a site page looks (`scripts/pr-screenshots.sh`)

## If this changes what gets sent

- [ ] Fixtures are **real recorded payloads**, with a note in the file saying where they came from
- [ ] At least one fixture carries data that must be stripped (a card field, an email), so the privacy rules are exercised rather than assumed
- [ ] `fixtures/.generated/events.json` is regenerated and committed (run the test suite without `CI=true`)
- [ ] Numbers are sent as numbers, not numeric strings

## If the PRD and the code now disagree

The PRD in `docs/PRD.md` is the spec. Say which side you changed and why:

<!-- e.g. "Updated AGENTS.md: the PRD assumed the integration test could run under jsdom." -->
