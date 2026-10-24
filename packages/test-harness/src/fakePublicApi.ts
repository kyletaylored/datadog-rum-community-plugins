import type { RumInitConfigurationLike, RumPublicApi } from '@kyletaylored/datadog-rum-community-plugins'

/** One recorded call to the RUM public API. */
export type RecordedCall =
  | { api: 'addAction'; name: string; context: Record<string, unknown> }
  | { api: 'setUser'; user: Record<string, unknown> }
  | { api: 'setAccount'; account: Record<string, unknown> }
  | { api: 'clearUser' }
  | { api: 'clearAccount' }
  | { api: 'setGlobalContextProperty'; key: string; value: unknown }
  | { api: 'addError'; error: unknown; context?: Record<string, unknown> }
  | { api: 'startView'; view: unknown }
  | { api: 'setTrackingConsent'; consent: string }

export interface FakeRum {
  publicApi: RumPublicApi
  initConfiguration: RumInitConfigurationLike
  /** Every call in order, which is what fixture snapshots assert on. */
  calls: RecordedCall[]
  /** Distinct RUM APIs touched, compared against the manifest's declared footprint. */
  apisUsed: () => string[]
  actions: () => Extract<RecordedCall, { api: 'addAction' }>[]
  globalContext: () => Record<string, unknown>
  reset: () => void
}

/**
 * A `publicApi` that records instead of sending. Adapters are driven against this in fixture
 * tests and in the conformance suite, so no test needs a real RUM init.
 */
export function createFakeRum(initConfiguration: RumInitConfigurationLike = {}): FakeRum {
  const calls: RecordedCall[] = []

  const publicApi: RumPublicApi = {
    addAction: (name, context) => {
      calls.push({ api: 'addAction', name, context: (context ?? {}) as Record<string, unknown> })
    },
    setUser: (user) => {
      calls.push({ api: 'setUser', user: { ...user } as Record<string, unknown> })
    },
    setAccount: (account) => {
      calls.push({ api: 'setAccount', account: { ...account } as Record<string, unknown> })
    },
    clearUser: () => {
      calls.push({ api: 'clearUser' })
    },
    clearAccount: () => {
      calls.push({ api: 'clearAccount' })
    },
    setGlobalContextProperty: (key, value) => {
      calls.push({ api: 'setGlobalContextProperty', key, value })
    },
    addError: (error, context) => {
      calls.push({ api: 'addError', error, context: context as Record<string, unknown> })
    },
    startView: (view) => {
      calls.push({ api: 'startView', view })
    },
    setTrackingConsent: (consent) => {
      calls.push({ api: 'setTrackingConsent', consent })
    },
  }

  return {
    publicApi,
    initConfiguration,
    calls,
    apisUsed: () => [...new Set(calls.map((call) => call.api))].sort(),
    actions: () => calls.filter((call): call is Extract<RecordedCall, { api: 'addAction' }> => call.api === 'addAction'),
    globalContext: () => {
      const context: Record<string, unknown> = {}
      for (const call of calls) {
        if (call.api === 'setGlobalContextProperty') context[call.key] = call.value
      }
      return context
    },
    reset: () => {
      calls.length = 0
    },
  }
}

/**
 * Install an in-memory `localStorage` for the duration of a test file, and return a restore
 * function. Node has `EventTarget` and `CustomEvent` but no `localStorage`, so without this the
 * core's dedupe silently falls back to its per-instance memory set and a reload test cannot tell
 * real deduplication from that fallback.
 */
export function installMemoryLocalStorage(): () => void {
  const target = globalThis as Record<string, unknown>
  const had = Object.prototype.hasOwnProperty.call(target, 'localStorage')
  const previous = target.localStorage
  Object.defineProperty(target, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  })
  return () => {
    if (had) {
      Object.defineProperty(target, 'localStorage', { value: previous, configurable: true, writable: true })
    } else {
      delete target.localStorage
    }
  }
}

/** In-memory `Storage`, so dedupe tests don't depend on the environment. */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  } as Storage
}
