/**
 * Writes what an adapter actually sent to `fixtures/.generated/events.json`, during the same
 * fixture run the snapshot test asserts on.
 *
 * The site's "Events this plugin sends" section reads these files. Generating them from the run
 * rather than writing them by hand is the point: the docs cannot drift from the mapping, because
 * the only way to change them is to change what the fixtures produce.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { familyOf } from '@kyletaylored/datadog-rum-community-plugins'
import type { FakeRum } from './fakePublicApi.js'
import type { JourneyReport } from './journey.js'

export interface EventReportEntry {
  /** Action name as sent, prefix included. */
  name: string
  /**
   * Attribute names seen on this action across the fixtures, each with its declared schema type.
   * The schema type is authoritative: a whole-number `value` of 56 is still a `number`, and
   * reporting it as an integer from one sample would mislead.
   */
  attributes: { name: string; type: string }[]
  /** How many fixtures produced this action. */
  occurrences: number
  /** One real attribute object from the run, so the docs can show a concrete example. */
  example: Record<string, unknown>
}

export interface EventReport {
  generatedFrom: string
  plugin: string
  actions: EventReportEntry[]
  globalContext: Record<string, unknown>
  rumApis: string[]
  /**
   * The manifest's `journey`, replayed step by step: what each fixture made the adapter send or
   * refuse. The plugin page's "What a visit sends" is rendered from this.
   */
  journey?: JourneyReport
}

/** The declared type for an attribute, falling back to the observed one when it is not in the schema. */
function typeOf(actionName: string, key: string, value: unknown): string {
  const declared = familyOf(actionName)?.attributes[key]?.type
  if (declared) return declared === 'items' ? 'array' : declared
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

/** Build the report from a completed fixture run. */
export function buildEventReport(plugin: string, rum: FakeRum, journey?: JourneyReport): EventReport {
  const byName = new Map<string, EventReportEntry>()

  for (const action of rum.actions()) {
    const existing = byName.get(action.name)
    const entry: EventReportEntry = existing ?? {
      name: action.name,
      attributes: [],
      occurrences: 0,
      example: action.context,
    }
    entry.occurrences += 1

    for (const [key, value] of Object.entries(action.context)) {
      if (!entry.attributes.some((attribute) => attribute.name === key)) {
        entry.attributes.push({ name: key, type: typeOf(action.name, key, value) })
      }
    }
    // Prefer the richest example, so the docs show a filled-in action rather than a sparse one.
    if (Object.keys(action.context).length > Object.keys(entry.example).length) {
      entry.example = action.context
    }

    byName.set(action.name, entry)
  }

  for (const entry of byName.values()) {
    entry.attributes.sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    generatedFrom: 'fixture run via @kyletaylored/datadog-rum-test-harness; do not edit by hand',
    plugin,
    actions: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    globalContext: rum.globalContext(),
    rumApis: rum.apisUsed(),
    ...(journey ? { journey } : {}),
  }
}

/**
 * Write the report next to the fixtures. Returns the path.
 *
 * `CI=true` makes this read-only: it compares instead of writing and throws when the committed
 * file is stale, so a mapping change without a regenerated report fails the build rather than
 * shipping docs that describe the old behaviour.
 */
export function writeEventReport(packageDir: string, plugin: string, rum: FakeRum, journey?: JourneyReport): string {
  const report = buildEventReport(plugin, rum, journey)
  const path = join(packageDir, 'fixtures/.generated/events.json')
  const serialized = `${JSON.stringify(report, null, 2)}\n`

  if (process.env.CI === 'true') {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (current !== serialized) {
      throw new Error(
        `${path} is out of date with the fixture run.\n` +
          'Run the test suite locally (without CI=true) and commit the regenerated file.',
      )
    }
    return path
  }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serialized)
  return path
}
