#!/usr/bin/env node
// Copies each plugin's package.json version into its plugin.json. `changeset version` bumps
// package.json only, and validate-manifests fails when the two disagree, so without this every
// release PR lands red and blocks its own publish. Runs as part of `npm run version-packages`.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { fromRoot } from './repo-root.mjs'

for (const dir of readdirSync(fromRoot('packages')).sort()) {
  const manifestPath = fromRoot('packages', dir, 'plugin.json')
  if (!existsSync(manifestPath)) continue

  const { version } = JSON.parse(readFileSync(fromRoot('packages', dir, 'package.json'), 'utf8'))
  const source = readFileSync(manifestPath, 'utf8')
  // Replace the field in place rather than re-serializing, so the file's formatting is untouched.
  const updated = source.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`)
  if (updated !== source) {
    writeFileSync(manifestPath, updated)
    console.log(`packages/${dir}/plugin.json -> ${version}`)
  }
}
