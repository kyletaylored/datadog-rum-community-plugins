#!/usr/bin/env node
// Enforces the PRD's 5 KB gzip budget on each adapter's CDN build. The CDN bundle is the one
// that matters: it carries the core inside it, so a merchant pastes a single script tag.
import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fromRoot, repoRoot } from './repo-root.mjs'

const LIMIT_BYTES = 5 * 1024
/** The core is a dependency of every adapter, not a CDN artifact of its own. */
const CORE_LIMIT_BYTES = 8 * 1024

/**
 * Per-plugin budgets, in KB gzipped.
 *
 * 5 KB is the default and applies to a platform adapter: subscribe to events, map them, done.
 * A plugin listed here does materially more than that, and the reason is recorded so the next
 * person can judge whether it is still true rather than finding a number with no story.
 */
const BUDGET_OVERRIDES_KB = {
  // Five independent trackers (scroll, links, downloads, video, forms) plus the DOM readers that
  // keep URLs, addresses and field values out of what is sent. Not a mapper, a small library.
  '@kyletaylored/datadog-rum-plugin-engagement': 6,
}

const packagesDir = fromRoot('packages')
const rows = []
let failed = false

for (const dir of readdirSync(packagesDir).sort()) {
  const pkgPath = join(packagesDir, dir, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg.private) continue

  const isAdapter = dir.startsWith('plugin-')
  const artifact = isAdapter ? join(packagesDir, dir, 'dist/plugin.js') : join(packagesDir, dir, 'dist/index.js')
  const override = BUDGET_OVERRIDES_KB[pkg.name]
  const limit = override ? override * 1024 : isAdapter ? LIMIT_BYTES : CORE_LIMIT_BYTES

  if (!existsSync(artifact)) {
    rows.push({ pkg: pkg.name, artifact: relative(repoRoot, artifact), gzip: null, limit, status: 'MISSING' })
    failed = true
    continue
  }

  const gzip = gzipSync(readFileSync(artifact), { level: 9 }).length
  const over = gzip > limit
  if (over) failed = true
  rows.push({ pkg: pkg.name, artifact, gzip, limit, status: over ? 'OVER' : 'ok' })
}

const pad = (value, width) => String(value).padEnd(width)
const widest = Math.max(...rows.map((row) => row.pkg.length), 7)

console.log(`${pad('package', widest)}  ${pad('gzip', 9)}  ${pad('limit', 9)}  status`)
for (const row of rows) {
  const size = row.gzip === null ? '-' : `${(row.gzip / 1024).toFixed(2)} KB`
  const budget = `${(row.limit / 1024).toFixed(0)} KB${BUDGET_OVERRIDES_KB[row.pkg] ? '*' : ''}`
  console.log(`${pad(row.pkg, widest)}  ${pad(size, 9)}  ${pad(budget, 9)}  ${row.status}`)
  if (row.status === 'MISSING') console.log(`${' '.repeat(widest)}  not built: ${row.artifact} — run npm run build`)
}

if (failed) {
  console.error('\nsize check failed')
  process.exit(1)
}
if (rows.some((row) => BUDGET_OVERRIDES_KB[row.pkg])) {
  console.log('\n* a declared budget above the 5 KB default — see BUDGET_OVERRIDES_KB for why')
}
console.log('\nsize check passed')
