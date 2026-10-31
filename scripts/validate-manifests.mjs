#!/usr/bin/env node
// Validates every plugin.json against the manifest JSON schema, and cross-checks the facts that
// a schema cannot: the package name, the version (in plugin.json and PLUGIN_VERSION), the
// schema version the core ships, and that every CDN install snippet loads the SDK major the
// plugins declare in rumSdk.
import Ajv from 'ajv'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fromRoot, repoRoot } from './repo-root.mjs'

const schema = JSON.parse(readFileSync(fromRoot('packages/core/schema/plugin-manifest.schema.json'), 'utf8'))
const coreSchemaVersion = /SCHEMA_VERSION = '([^']+)'/.exec(
  readFileSync(fromRoot('packages/core/src/schema/keys.ts'), 'utf8'),
)?.[1]

// This cross-check reads the constant out of a source file, so a move silently turns it off —
// which is exactly what happened when SCHEMA_VERSION moved out of registry.ts. Fail loudly
// instead of reporting "valid against schema undefined".
if (!coreSchemaVersion) {
  console.error('could not read SCHEMA_VERSION from packages/core/src/schema/keys.ts — has it moved?')
  process.exit(1)
}

const ajv = new Ajv({ allErrors: true, strict: false, formats: { uri: true } })
const validate = ajv.compile(schema)

const problems = []
let checked = 0

for (const dir of readdirSync(fromRoot('packages')).sort()) {
  const manifestPath = fromRoot('packages', dir, 'plugin.json')
  if (!existsSync(manifestPath)) continue
  checked += 1

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const pkg = JSON.parse(readFileSync(fromRoot('packages', dir, 'package.json'), 'utf8'))
  // Repo-relative, so the message is the same wherever the script was run from.
  const where = relative(repoRoot, manifestPath)

  if (!validate(manifest)) {
    for (const error of validate.errors ?? []) {
      problems.push(`${where}: ${error.instancePath || '/'} ${error.message}`)
    }
  }

  if (manifest.package !== pkg.name) {
    problems.push(`${where}: package is "${manifest.package}" but package.json says "${pkg.name}"`)
  }
  if (manifest.version !== pkg.version) {
    problems.push(`${where}: version is ${manifest.version} but package.json says ${pkg.version}`)
  }
  // The export name is used verbatim in the site's install snippets, so a typo there ships a
  // copy-paste snippet that throws. Check it against the source.
  const entry = fromRoot('packages', dir, 'src/index.ts')
  if (existsSync(entry)) {
    const source = readFileSync(entry, 'utf8')
    if (!source.includes(`export function ${manifest.exportName}(`)) {
      problems.push(`${where}: exportName "${manifest.exportName}" is not exported by src/index.ts`)
    }
    // Sent on every event as commerce.plugin_version, so a stale one mislabels every session.
    const sourceVersion = /export const PLUGIN_VERSION = '([^']*)'/.exec(source)?.[1]
    if (sourceVersion !== pkg.version) {
      problems.push(`${where}: src/index.ts PLUGIN_VERSION is ${sourceVersion} but package.json says ${pkg.version}`)
    }
  }

  if (manifest.name !== dir.replace(/^plugin-/, '')) {
    problems.push(`${where}: name "${manifest.name}" does not match the directory packages/${dir}`)
  }
  if (coreSchemaVersion && manifest.schemaVersion !== coreSchemaVersion) {
    problems.push(`${where}: schemaVersion ${manifest.schemaVersion} but the core ships ${coreSchemaVersion}`)
  }

  // The footprint is a promise to the merchant; an empty one on an adapter that reads a platform
  // is almost always an oversight rather than a true "touches nothing".
  if (manifest.family !== 'consent' && (manifest.actions ?? []).length === 0) {
    problems.push(`${where}: a ${manifest.family} adapter declares no actions`)
  }
  // The journey drives the plugin page. A step naming a fixture that does not exist would make
  // the snapshot test throw, but saying which step here is a faster failure to read.
  const fixturesDir = fromRoot('packages', dir, 'fixtures')
  const fixtureNames = new Set(
    existsSync(fixturesDir)
      ? readdirSync(fixturesDir)
          .filter((file) => file.endsWith('.json'))
          .flatMap((file) => {
            const parsed = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'))
            return (Array.isArray(parsed) ? parsed : parsed.fixtures).map((fixture) => fixture.name)
          })
      : [],
  )
  for (const [index, step] of (manifest.journey ?? []).entries()) {
    if (!fixtureNames.has(step.fixture)) {
      problems.push(`${where}: journey[${index}] "${step.label}" names fixture "${step.fixture}", which is not in fixtures/*.json`)
    }
  }

  if (manifest.footprint.rumApis.length === 0) {
    problems.push(`${where}: footprint.rumApis is empty; every adapter calls at least one RUM API`)
  }
}

// Every CDN install snippet loads the Browser SDK by major version
// (datadoghq-browser-agent.com/<site>/v7/datadog-rum.js). A snippet on a different major from the
// plugins' peer range hands a merchant an SDK the plugins were never tested against, and nothing
// else catches it: the snippets are prose. Every manifest declares the same range, so its major
// is the one the snippets must load.
const sdkMajors = new Set()
for (const dir of readdirSync(fromRoot('packages'))) {
  const manifestPath = fromRoot('packages', dir, 'plugin.json')
  if (!existsSync(manifestPath)) continue
  const major = />=\s*(\d+)\./.exec(JSON.parse(readFileSync(manifestPath, 'utf8')).rumSdk ?? '')?.[1]
  if (major) sdkMajors.add(major)
}
if (sdkMajors.size !== 1) {
  problems.push(`plugin.json rumSdk ranges disagree on the SDK major (${[...sdkMajors].join(', ') || 'none'}); the CDN snippets cannot match them all`)
} else {
  const [major] = sdkMajors
  const snippetFiles = [
    'README.md',
    'docs/PRD.md',
    'templates/plugin/README.md',
    ...readdirSync(fromRoot('packages')).map((dir) => join('packages', dir, 'README.md')),
    ...['site/src/components', 'site/src/pages', 'site/src/pages/docs', 'site/src/layouts'].flatMap((dir) =>
      existsSync(fromRoot(dir)) ? readdirSync(fromRoot(dir)).filter((file) => file.endsWith('.astro')).map((file) => join(dir, file)) : [],
    ),
  ]
  for (const file of snippetFiles) {
    if (!existsSync(fromRoot(file))) continue
    readFileSync(fromRoot(file), 'utf8').split('\n').forEach((line, index) => {
      for (const found of line.matchAll(/datadoghq-browser-agent\.com\/[^/"'\s]+\/v(\d+)\/datadog-rum/g)) {
        if (found[1] !== major) {
          problems.push(`${file}:${index + 1}: CDN snippet loads SDK v${found[1]}, but plugin.json declares rumSdk ${major}.x`)
        }
      }
    })
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} manifest problem(s):`)
  for (const problem of problems) console.error(`  ${problem}`)
  if (problems.some((problem) => problem.includes('package.json says'))) {
    console.error('Version drift: run "node scripts/sync-manifest-versions.mjs" and commit the result.')
  }
  process.exit(1)
}

console.log(`${checked} plugin manifest(s) valid against schema ${coreSchemaVersion}`)
