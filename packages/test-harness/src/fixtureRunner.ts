import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginManifest, RumPlugin } from '@kyletaylored/datadog-rum-community-plugins'
import { createFakeRum, createMemoryStorage, type FakeRum, type RecordedCall } from './fakePublicApi.js'
import { checkConformance, formatFindings, type ConformanceResult } from './conformance.js'

/**
 * A recorded platform payload and what the adapter should do with it.
 *
 * `emit` is how the fixture reaches the adapter: the harness hands it to the platform double the
 * adapter subscribed to, so the adapter's own subscription code is under test, not bypassed.
 */
export interface Fixture {
  name: string
  description?: string
  /** Platform event name, as the platform spells it. */
  event: string
  payload: unknown
}

export interface FixtureFile {
  /** Fixtures replayed in order; order matters for dedupe and consent cases. */
  fixtures: Fixture[]
}

export function loadFixtures(dir: string): { file: string; fixtures: Fixture[] }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as FixtureFile | Fixture[]
      const fixtures = Array.isArray(parsed) ? parsed : parsed.fixtures
      return { file: name, fixtures }
    })
}

export interface RunOptions {
  /** Builds the adapter under test with the options this run should use. */
  plugin: RumPlugin
  /** Hands one recorded payload to whatever platform source the adapter subscribed to. */
  emit: (fixture: Fixture) => void | Promise<void>
  /** Called after `onInit` and before the fixtures, e.g. to accept consent. */
  afterInit?: (rum: FakeRum) => void | Promise<void>
  initConfiguration?: Record<string, unknown>
}

export interface RunResult {
  rum: FakeRum
  calls: RecordedCall[]
  /** `false` when the plugin opted out of this page, the way shopifyPlugin does. */
  initialized: boolean
}

/** Initialize an adapter against the fake API, then replay fixtures through its own subscription. */
export async function runFixtures(fixtures: Fixture[], options: RunOptions): Promise<RunResult> {
  const rum = createFakeRum(options.initConfiguration ?? {})
  const outcome = await options.plugin.onInit?.({
    initConfiguration: rum.initConfiguration,
    publicApi: rum.publicApi,
  })

  if (outcome === false) {
    return { rum, calls: rum.calls, initialized: false }
  }

  await options.afterInit?.(rum)

  for (const fixture of fixtures) {
    await options.emit(fixture)
  }

  return { rum, calls: rum.calls, initialized: true }
}

/** Run every fixture in a directory, then the shared conformance suite over the whole recording. */
export async function runConformance(
  input: RunOptions & {
    fixturesDir: string
    manifest: PluginManifest
    options?: { includeEmail?: boolean; includeName?: boolean; includeItems?: boolean; actionPrefix?: string }
  },
): Promise<ConformanceResult & { rum: FakeRum }> {
  const all = loadFixtures(input.fixturesDir).flatMap((entry) => entry.fixtures)
  const run = await runFixtures(all, input)
  const result = checkConformance({ manifest: input.manifest, rum: run.rum, options: input.options })
  return { ...result, rum: run.rum }
}

export { createFakeRum, createMemoryStorage, checkConformance, formatFindings }
export type { FakeRum, RecordedCall, ConformanceResult }
