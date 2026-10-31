#!/usr/bin/env node
// Checks the demo sites against the rules in AGENTS.md "Demo sites": every plugin has one, every
// sandbox scenario is playable, every declared action is accounted for, and no demo calls a RUM
// API, holds a credential or links to an absolute path. Static checks only; the browser test plays
// the scenarios for real.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fromRoot, repoRoot } from './repo-root.mjs'

const demosDir = fromRoot('site/public/demos')
const presets = JSON.parse(readFileSync(fromRoot('site/src/lib/sandbox-scenarios.json'), 'utf8'))
const problems = []

/** Generated into _shared by build-demos.mjs; not hand-written, so not linted. */
const GENERATED = [join(demosDir, '_shared/runtime.js'), join(demosDir, '_shared/plugins'), join(demosDir, '_shared/fixtures')]

/** The source of `export const <name> = { ... }`, by brace depth. */
function exportedObject(source, name) {
  const start = new RegExp(`export const ${name}\\s*=\\s*\\{`).exec(source)
  if (!start) return null
  let depth = 1
  let index = start.index + start[0].length
  while (depth > 0 && index < source.length) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    index += 1
  }
  return source.slice(start.index + start[0].length, index - 1)
}

/** Top-level quoted keys of an object literal's body. */
function topLevelKeys(body) {
  const keys = []
  let depth = 0
  const pattern = /[{}[\]()]|'([^']+)'\s*:/g
  let match
  while ((match = pattern.exec(body))) {
    if ('{[('.includes(match[0])) depth += 1
    else if ('}])'.includes(match[0])) depth -= 1
    else if (depth === 0) keys.push(match[1])
  }
  return keys
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (GENERATED.some((generated) => path === generated || path.startsWith(`${generated}/`))) return []
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

let checked = 0
for (const dir of readdirSync(fromRoot('packages')).sort()) {
  if (!dir.startsWith('plugin-')) continue
  const name = dir.replace(/^plugin-/, '')
  const manifest = JSON.parse(readFileSync(fromRoot('packages', dir, 'plugin.json'), 'utf8'))
  const demo = join(demosDir, name)
  checked += 1

  if (!existsSync(join(demo, 'index.html'))) problems.push(`demos/${name}: no index.html (every plugin ships a demo site)`)
  const demoJs = join(demo, 'demo.js')
  if (!existsSync(demoJs)) {
    problems.push(`demos/${name}: no demo.js`)
    continue
  }
  const source = readFileSync(demoJs, 'utf8')

  const scenarios = exportedObject(source, 'scenarios')
  const playable = scenarios === null ? [] : topLevelKeys(scenarios)
  if (scenarios === null) problems.push(`demos/${name}/demo.js: does not export scenarios`)
  const declared = presets.plugins[name]?.scenarios ?? []
  if (!presets.plugins[name]) problems.push(`sandbox-scenarios.json: no entry for ${name}`)
  for (const scenario of declared) {
    if (!playable.includes(scenario.id)) problems.push(`demos/${name}/demo.js: scenario "${scenario.id}" (${scenario.label}) is not in scenarios`)
  }
  for (const id of playable) {
    if (!declared.some((scenario) => scenario.id === id)) problems.push(`demos/${name}/demo.js: scenario "${id}" is not a sandbox preset`)
  }

  const coverage = exportedObject(source, 'coverage')
  if (coverage === null) {
    problems.push(`demos/${name}/demo.js: does not export coverage`)
  } else {
    const listed = [...coverage.matchAll(/'([a-z]+\.[a-z_]+)'\s*:/g)].map((match) => match[1])
    for (const action of manifest.actions ?? []) {
      if (!listed.includes(action)) problems.push(`demos/${name}/demo.js: ${action} is declared by the plugin but not in coverage`)
    }
  }
}

// Rules for every hand-written demo file.
const RUM_CALL = /\.(addAction|setUser|setAccount|setGlobalContextProperty|setTrackingConsent|startView|addError|clearUser|clearAccount)\s*\(|DD_RUM\.init|datadogRum\b/
const CREDENTIAL = /applicationId|clientToken|pub[0-9a-f]{32}/
const ABSOLUTE = /(?:src|href|action)\s*=\s*["'`]\/(?!\/)|location\.href\s*=\s*["'`]\//
for (const file of walk(demosDir)) {
  if (!/\.(html|js|css)$/.test(file)) continue
  const where = relative(repoRoot, file)
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    // Prose in a comment may name the APIs; code may not call them.
    const code = line.replace(/\/\*.*?\*\/|\/\/.*$|^\s*\/?\*.*$|<!--.*?-->/g, '')
    if (RUM_CALL.test(code)) problems.push(`${where}:${index + 1}: a demo must not call a RUM API; the plugin does the mapping`)
    if (CREDENTIAL.test(code)) problems.push(`${where}:${index + 1}: no application ID or client token in a demo`)
    if (ABSOLUTE.test(code)) problems.push(`${where}:${index + 1}: absolute path; the site is served from a subpath`)
  })
}

if (problems.length > 0) {
  console.error(`${problems.length} demo problem(s):`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`${checked} demo site(s) ok: every plugin has one, every scenario is playable, every action is accounted for`)
