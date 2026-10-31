#!/usr/bin/env node
/**
 * Scaffold a new adapter from templates/plugin.
 *
 *   npm run new-plugin -- onetrust --title "OneTrust" --family consent --maintainer "You <you@example.com>" --github you
 *
 * It only copies and renames. The scaffold's tests pass against an empty mapping on purpose, so
 * a new contributor starts from green and watches each assertion tighten as they fill the
 * mapping in: replace the expected action list, record real fixtures, update the footprint.
 */
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fromRoot, repoRoot } from './repo-root.mjs'

const args = process.argv.slice(2)
const name = args.find((arg) => !arg.startsWith('--'))

function flag(flagName, fallback) {
  const index = args.indexOf(`--${flagName}`)
  return index === -1 ? fallback : (args[index + 1] ?? fallback)
}

if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('usage: npm run new-plugin -- <name> [--title "Title"] [--family commerce|consent|identity|support|lead|learning]')
  console.error('       <name> is lower-case letters, digits and hyphens, e.g. "bigcommerce" or "wp-consent-api"')
  process.exit(1)
}

const target = fromRoot('packages', `plugin-${name}`)
const targetLabel = relative(repoRoot, target)
if (existsSync(target)) {
  console.error(`${targetLabel} already exists`)
  process.exit(1)
}

const title = flag('title', name.replace(/(^|-)([a-z])/g, (_, sep, char) => (sep ? ' ' : '') + char.toUpperCase()))
const family = flag('family', 'commerce')
const maintainer = flag('maintainer', 'Your Name <you@example.com>')
const github = flag('github', 'your-github-handle')

/** `wp-consent-api` → `wpConsentApi` for the exported factory. */
const fnName = name.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase())
/** `wp-consent-api` → `WP_CONSENT_API` for the events constant. */
const constName = name.toUpperCase().replace(/-/g, '_')
/** `wp-consent-api` → `WpConsentApi` for the options interface. */
const typeName = fnName.charAt(0).toUpperCase() + fnName.slice(1)

const replacements = [
  [/__NAME_CONST__/g, constName],
  [/__TITLE_CONST__/g, typeName],
  [/__NAME_FN__/g, fnName],
  [/__NAME__/g, name],
  [/__TITLE__/g, title],
  [/__MAINTAINER__/g, maintainer],
  [/__GITHUB__/g, github],
]

cpSync(fromRoot('templates/plugin'), target, { recursive: true })

function rewrite(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      rewrite(path)
      continue
    }
    let content = readFileSync(path, 'utf8')
    for (const [pattern, value] of replacements) content = content.replace(pattern, value)
    writeFileSync(path, content)
  }
}

rewrite(target)

// The manifest's family comes from the flag rather than the template's default.
const manifestPath = join(target, 'plugin.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.family = family
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// Rename the template's test to match the adapter, so `vitest` picks it up under its own name.
renameSync(join(target, 'test/plugin.test.ts'), join(target, `test/${name}.test.ts`))

// Register the package in the root solution tsconfig, so `npm run typecheck` covers it. Doing
// this by hand is the kind of step that gets forgotten until CI fails on someone else's PR.
const rootTsconfigPath = fromRoot('tsconfig.json')
const rootTsconfig = JSON.parse(readFileSync(rootTsconfigPath, 'utf8'))
const reference = { path: `./packages/plugin-${name}` }
if (!rootTsconfig.references.some((entry) => entry.path === reference.path)) {
  rootTsconfig.references.push(reference)
  writeFileSync(rootTsconfigPath, `${JSON.stringify(rootTsconfig, null, 2)}\n`)
}

console.log(`created ${targetLabel}`)
console.log('')
console.log('next:')
console.log(`  1. record real platform payloads into ${targetLabel}/fixtures/`)
console.log(`  2. map them in ${targetLabel}/src/index.ts, and update FOOTPRINT`)
console.log(`  3. keep ${targetLabel}/plugin.json in step: actions, options, footprint`)
console.log(`  4. npm install && npx vitest run packages/plugin-${name}`)
console.log('  5. npm run verify')
console.log('')
console.log(`registered packages/plugin-${name} in the root tsconfig; run "npm install" to link the workspace`)
