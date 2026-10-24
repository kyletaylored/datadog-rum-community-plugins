#!/usr/bin/env node
// Validates every plugin.json against the manifest JSON schema, and cross-checks the facts that
// a schema cannot: the package name, the version, and the schema version the core ships.
import Ajv from 'ajv'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { relative } from 'node:path'
import { fromRoot, repoRoot } from './repo-root.mjs'

const schema = JSON.parse(readFileSync(fromRoot('packages/core/schema/plugin-manifest.schema.json'), 'utf8'))
const coreSchemaVersion = /SCHEMA_VERSION = '([^']+)'/.exec(
  readFileSync(fromRoot('packages/core/src/schema/registry.ts'), 'utf8'),
)?.[1]

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
  if (manifest.footprint.rumApis.length === 0) {
    problems.push(`${where}: footprint.rumApis is empty; every adapter calls at least one RUM API`)
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} manifest problem(s):`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log(`${checked} plugin manifest(s) valid against schema ${coreSchemaVersion}`)
