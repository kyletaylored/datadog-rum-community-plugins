/**
 * Replays a plugin's `journey` (from `plugin.json`) through the adapter's own subscription and
 * records, per step, every call it made and every call it refused to make.
 *
 * The plugin page renders this as "What a visit sends", so the rows cannot drift from the code:
 * each one is what the adapter did with a recorded fixture. Steps are replayed in journey order,
 * not fixture order, because order is the point for a reload: the second "order received" is
 * refused only because the first one was sent.
 */
import { blockedKeys } from '@kyletaylored/datadog-rum-community-plugins'
import type { RumInitConfigurationLike, RumPublicApi } from '@kyletaylored/datadog-rum-community-plugins'
import { createMemoryStorage } from './fakePublicApi.js'
import type { Fixture } from './fixtureRunner.js'

/** One call, in the shape the site renders. The sandbox's `SandboxCall` is the same shape. */
export interface JourneyCall {
  api: string
  /** Action name, context key or consent state. */
  label?: string
  detail?: unknown
  /** Set when the core refused to send something, with its reason. */
  blocked?: string
  /** Keys present in the platform payload that the core kept out of this call. */
  stripped?: string[]
}

export interface JourneyStepReport {
  label: string
  fixture: string
  /** The platform event, as the platform spells it. */
  event: string
  calls: JourneyCall[]
}

export interface JourneyReport {
  /** The options the journey was replayed with, so the page can say so. */
  options: Record<string, unknown>
  /** Step 0: what `onInit` did before any platform event arrived. */
  init: JourneyCall[]
  steps: JourneyStepReport[]
}

export interface JourneyStep {
  label: string
  fixture: string
}

export interface RecordJourneyInput {
  /** The logger tag the adapter uses, e.g. `woocommerce` for `[dd-rum:woocommerce]`. */
  platform: string
  journey: JourneyStep[]
  fixtures: Fixture[]
  /** Options to report; `start` is responsible for passing them, plus `debug: true`, to the plugin. */
  options: Record<string, unknown>
  /**
   * Initialize the adapter against the recording API and return the function that hands one
   * fixture to the platform double it subscribed to.
   */
  start: (context: {
    publicApi: RumPublicApi
    initConfiguration: RumInitConfigurationLike
  }) => Promise<(fixture: Fixture) => void | Promise<void>> | ((fixture: Fixture) => void | Promise<void>)
  /** What a step's payload carried that must not arrive. Defaults to the blocked keys in the payload. */
  strippedFor?: (fixture: Fixture) => string[]
}

export async function recordJourney(input: RecordJourneyInput): Promise<JourneyReport> {
  const calls: JourneyCall[] = []
  const tag = `[dd-rum:${input.platform}]`

  // Refusals produce no RUM call, so the only place they show up is the core's debug log. The
  // adapter runs with `debug: true` and every tagged line is read here rather than printed.
  const original = { log: console.log, warn: console.warn }
  const intercept = (level: 'log' | 'warn') => (...args: unknown[]) => {
    if (typeof args[0] !== 'string' || !args[0].startsWith(tag)) {
      original[level].apply(console, args as never)
      return
    }
    if (args[0].slice(tag.length).trim() === 'dropped') {
      calls.push({
        api: 'not sent',
        label: String(args[1] ?? ''),
        blocked: String(args[2] ?? '').replace(/^\(|\)$/g, ''),
      })
    }
  }

  const publicApi: RumPublicApi = {
    addAction: (name, context) => void calls.push({ api: 'addAction', label: name, detail: context ?? {} }),
    setUser: (user) => void calls.push({ api: 'setUser', detail: { ...user } }),
    setAccount: (account) => void calls.push({ api: 'setAccount', detail: { ...account } }),
    clearUser: () => void calls.push({ api: 'clearUser' }),
    clearAccount: () => void calls.push({ api: 'clearAccount' }),
    setGlobalContextProperty: (key, value) => void calls.push({ api: 'setGlobalContextProperty', label: key, detail: value }),
    addError: (error, context) => void calls.push({ api: 'addError', detail: { error, context } }),
    startView: (view) => void calls.push({ api: 'startView', detail: view }),
    setTrackingConsent: (consent) => void calls.push({ api: 'setTrackingConsent', label: consent }),
  }

  // Fresh storage, so the purchase dedupe starts empty and a reload step is refused for the
  // reason the page claims, not because of a leftover entry.
  const target = globalThis as Record<string, unknown>
  const hadStorage = Object.prototype.hasOwnProperty.call(target, 'localStorage')
  const previousStorage = target.localStorage
  Object.defineProperty(target, 'localStorage', { value: createMemoryStorage(), configurable: true, writable: true })

  console.log = intercept('log')
  console.warn = intercept('warn')

  const byName = new Map(input.fixtures.map((fixture) => [fixture.name, fixture]))
  const strippedFor = input.strippedFor ?? ((fixture: Fixture) => blockedKeys(fixture.payload))

  try {
    const initConfiguration: RumInitConfigurationLike = {}
    const emit = await input.start({ publicApi, initConfiguration })
    // A consent plugin's whole job at init is to rewrite the init options, which is no RUM call.
    if (initConfiguration.trackingConsent) {
      calls.unshift({ api: 'init', label: `trackingConsent = '${initConfiguration.trackingConsent}'` })
    }
    const init = calls.splice(0)

    const steps: JourneyStepReport[] = []
    for (const step of input.journey) {
      const fixture = byName.get(step.fixture)
      if (!fixture) throw new Error(`journey step "${step.label}" names fixture "${step.fixture}", which does not exist`)
      await emit(fixture)
      const stepCalls = calls.splice(0)
      const stripped = strippedFor(fixture)
      if (stripped.length > 0) {
        for (const call of stepCalls) if (call.api === 'addAction') call.stripped = stripped
      }
      steps.push({ label: step.label, fixture: fixture.name, event: fixture.event, calls: stepCalls })
    }

    return { options: input.options, init, steps }
  } finally {
    console.log = original.log
    console.warn = original.warn
    if (hadStorage) {
      Object.defineProperty(target, 'localStorage', { value: previousStorage, configurable: true, writable: true })
    } else {
      delete target.localStorage
    }
  }
}
