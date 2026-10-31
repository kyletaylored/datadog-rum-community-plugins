#!/usr/bin/env node
/**
 * Generates the site's data files from the repo itself, so the docs cannot drift from the code:
 *
 *   site/src/data/schema.json     every family, action and attribute, from the core's schemas
 *   site/src/data/plugins.json    every plugin.json, plus the events its fixture run produced
 *   site/src/data/scenarios.json  the recorded fixtures, so the sandbox replays the same payloads
 *                                 the test suite does rather than a hand-written imitation
 *
 * "Events this plugin sends" comes from `fixtures/.generated/events.json`, which the adapter's
 * own snapshot test writes during its fixture run. Nothing here is hand-written.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromRoot } from './repo-root.mjs'

const outDir = fromRoot('site/src/data')
mkdirSync(outDir, { recursive: true })

// The core is TypeScript, so read the built ESM. `npm run build` runs before this in CI.
const coreEntry = fromRoot('packages/core/dist/index.js')
if (!existsSync(coreEntry)) {
  console.error(`${coreEntry} not found — run "npm run build" first`)
  process.exit(1)
}
const core = await import(pathToFileURL(coreEntry).href)

const schema = {
  version: core.SCHEMA_VERSION,
  families: Object.values(core.FAMILIES).map((family) => ({
    family: family.family,
    prefix: family.prefix,
    actions: family.actions.map((action) => ({
      name: `${family.prefix}${action.event}`,
      event: action.event,
      ga4: action.ga4,
      firesWhen: action.firesWhen,
      keyAttributes: action.keyAttributes,
    })),
    attributes: Object.entries(family.attributes).map(([name, spec]) => ({
      name,
      type: spec.type,
      origin: spec.origin,
      description: spec.description,
      example: spec.example ?? null,
    })),
  })),
  globalContext: Object.entries(core.GLOBAL_CONTEXT_KEYS).map(([key, path]) => ({ key, path })),
  limits: {
    maxItems: core.MAX_ITEMS,
    maxStringLength: core.MAX_STRING_LENGTH,
    dedupeTtlHours: core.DEDUPE_TTL_MS / 3_600_000,
  },
}

writeFileSync(join(outDir, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`)

const plugins = []
for (const dir of readdirSync(fromRoot('packages')).sort()) {
  const manifestPath = fromRoot('packages', dir, 'plugin.json')
  if (!existsSync(manifestPath)) continue

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const reportPath = fromRoot('packages', dir, 'fixtures/.generated/events.json')
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null

  if (!report) {
    console.warn(`${dir}: no fixture event report; run the test suite so the gallery can show what it sends`)
  }

  // The sandbox replays these in the browser. Reading the same files the tests do is the point:
  // a hand-written demo payload would drift from what the adapter is actually tested against.
  const fixturesDir = fromRoot('packages', dir, 'fixtures')
  const fixtures = existsSync(fixturesDir)
    ? readdirSync(fixturesDir)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .flatMap((file) => {
          const parsed = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'))
          const list = Array.isArray(parsed) ? parsed : parsed.fixtures
          return list.map((fixture) => ({ ...fixture, file, source: parsed.source ?? null }))
        })
    : []

  const readmePath = fromRoot('packages', dir, 'README.md')

  plugins.push({
    ...manifest,
    fixtures,
    events: report?.actions ?? [],
    globalContext: report?.globalContext ?? {},
    observedRumApis: report?.rumApis ?? [],
    // The manifest's journey, replayed by the snapshot test: what each step sent or refused.
    journeyReport: report?.journey ?? null,
    readme: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null,
  })
}

writeFileSync(join(outDir, 'plugins.json'), `${JSON.stringify(plugins, null, 2)}\n`)

const actionCount = schema.families.reduce((total, family) => total + family.actions.length, 0)
console.log(`schema ${schema.version}: ${schema.families.length} families, ${actionCount} actions`)
console.log(`plugins: ${plugins.length} (${plugins.filter((plugin) => plugin.events.length > 0).length} with generated event lists)`)
console.log(`sandbox fixtures: ${plugins.reduce((total, plugin) => total + plugin.fixtures.length, 0)}`)
