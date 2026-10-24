// Scripts are run both from the repo root (`npm run size`) and from a workspace (the site's build
// calls gen-schema-docs). Resolving against cwd works in the first case and silently breaks in the
// second, so every script resolves against the repo root instead, derived from this file.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Join a repo-relative path, e.g. `fromRoot('packages/core/dist/index.js')`. */
export function fromRoot(...parts) {
  return join(repoRoot, ...parts)
}
