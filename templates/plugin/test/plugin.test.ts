import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  checkConformance,
  createFakeRum,
  formatFindings,
  installMemoryLocalStorage,
  loadFixtures,
  type Fixture,
} from '../../test-harness/src/index.js'
import type { PluginManifest } from '@kyletaylored/datadog-rum-community-plugins'
import { __NAME_CONST___EVENTS, __NAME_FN__Plugin } from '../src/index.js'

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../plugin.json', import.meta.url)), 'utf8'),
) as PluginManifest

/** Hand one recorded payload to whatever the adapter subscribed to, so its own code runs. */
function emit(fixture: Fixture): void {
  void fixture
  // platformDouble.emit(fixture.event, fixture.payload)
}

function replay(): void {
  for (const fixture of loadFixtures(fixturesDir).flatMap((entry) => entry.fixtures)) emit(fixture)
}

async function run(options: Parameters<typeof __NAME_FN__Plugin>[0] = {}) {
  // Fresh storage per run: the purchase dedupe is shared state, and a leftover entry from an
  // earlier test would look exactly like working deduplication.
  const restore = installMemoryLocalStorage()
  const rum = createFakeRum({})
  const plugin = __NAME_FN__Plugin({ consent: 'ignore', ...options })
  await plugin.onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
  replay()
  return { rum, restore }
}

describe('__NAME__ adapter', () => {
  it('maps the recorded fixtures to the schema', async () => {
    const { rum, restore } = await run()
    // Replace with the action names this adapter should produce, in order.
    expect(rum.actions().map((action) => action.name)).toEqual([])
    restore()
  })

  it('matches the committed snapshot for every mapped action', async () => {
    const { rum, restore } = await run({ includeItems: true })
    expect(rum.actions()).toMatchSnapshot()
    restore()
  })

  it('listens on every event the manifest declares', () => {
    expect([...__NAME_CONST___EVENTS].sort()).toEqual([...manifest.footprint.events].sort())
  })

  it('sends nothing before consent is granted', async () => {
    const restore = installMemoryLocalStorage()
    const rum = createFakeRum({})
    // No `consent` option: the core holds everything until the adapter reports a grant.
    await __NAME_FN__Plugin().onInit?.({
      initConfiguration: rum.initConfiguration,
      publicApi: rum.publicApi,
    })
    replay()
    expect(rum.actions()).toHaveLength(0)
    expect(rum.calls.some((call) => call.api === 'setUser')).toBe(false)
    restore()
  })
})

describe('conformance', () => {
  it('passes the shared suite with default options', async () => {
    const { rum, restore } = await run()
    expect(formatFindings(checkConformance({ manifest, rum }))).toBe('conformance: ok')
    restore()
  })

  it('passes with items and PII opted in', async () => {
    const { rum, restore } = await run({ includeItems: true, includeEmail: true, includeName: true })
    const result = checkConformance({
      manifest,
      rum,
      options: { includeItems: true, includeEmail: true, includeName: true },
    })
    expect(formatFindings(result)).toBe('conformance: ok')
    restore()
  })

  it('declares a footprint that matches what the run actually did', async () => {
    const { rum, restore } = await run()
    for (const api of rum.apisUsed()) {
      expect(manifest.footprint.rumApis, `plugin.json must declare ${api}`).toContain(api)
    }
    restore()
  })
})
