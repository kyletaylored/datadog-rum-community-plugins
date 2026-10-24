#!/usr/bin/env node
/**
 * Computes the SRI hash of every adapter's CDN build, and the exact-version jsDelivr URL that
 * goes with it.
 *
 * Merchants paste these into a page, so they are the security boundary for the CDN install path:
 * a pinned version plus an `integrity` attribute means a compromised CDN cannot serve different
 * code. This project never documents an unpinned `latest` URL.
 *
 *   node scripts/sri.mjs                 print a table
 *   node scripts/sri.mjs --write sri.json  also write a machine-readable manifest
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fromRoot, repoRoot } from './repo-root.mjs'

const writeIndex = process.argv.indexOf('--write')
const outPath = writeIndex === -1 ? null : process.argv[writeIndex + 1]

const entries = []

for (const dir of readdirSync(fromRoot('packages')).sort()) {
  if (!dir.startsWith('plugin-')) continue
  const pkgPath = fromRoot('packages', dir, 'package.json')
  if (!existsSync(pkgPath)) continue

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const artifact = fromRoot('packages', dir, 'dist/plugin.js')

  if (!existsSync(artifact)) {
    console.error(`${pkg.name}: ${relative(repoRoot, artifact)} not built — run "npm run build" first`)
    process.exitCode = 1
    continue
  }

  const bytes = readFileSync(artifact)
  const integrity = `sha384-${createHash('sha384').update(bytes).digest('base64')}`

  entries.push({
    package: pkg.name,
    version: pkg.version,
    url: `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/dist/plugin.js`,
    integrity,
    bytes: bytes.length,
  })
}

for (const entry of entries) {
  console.log(`${entry.package}@${entry.version}`)
  console.log(`  ${entry.url}`)
  console.log(`  integrity="${entry.integrity}"`)
}

if (outPath) {
  writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2)}\n`)
  console.log(`\nwrote ${outPath}`)
}

if (entries.length === 0) {
  console.error('no CDN builds found')
  process.exit(1)
}
