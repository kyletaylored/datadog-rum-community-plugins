import type { ConsentState, RumInitConfigurationLike, RumPublicApi } from '../types.js'
import { GLOBAL_CONTEXT_KEYS } from '../schema/keys.js'

/**
 * Holds every event until consent is granted.
 *
 * Nothing is queued: a declined visitor sends nothing at all, which is why RUM cannot report
 * opt-in rate (see the PRD). Events that arrive while the decision is pending are dropped, not
 * buffered, so a later "granted" never backfills pre-consent activity.
 */
export interface ConsentGate {
  state: () => ConsentState
  /** True when events may be sent right now. */
  isOpen: () => boolean
  /** Record a grant and release the SDK's tracking consent. */
  grant: (categories?: string[]) => void
  /** Record a denial. Events stay blocked. */
  deny: () => void
  /** Called by the core when an event is dropped, for the debug log and conformance counters. */
  onBlocked: (handler: (name: string) => void) => void
  notifyBlocked: (name: string) => void
}

export interface ConsentGateOptions {
  /**
   * `ignore` trusts the host page's own `trackingConsent` and opens the gate immediately.
   * `auto` (default) closes it until the adapter reports a grant.
   */
  mode: 'auto' | 'ignore'
  publicApi: RumPublicApi
  /** Set to `not-granted` in `onInit`, the way `shopifyPlugin` rewrites init options. */
  initConfiguration?: RumInitConfigurationLike
}

export function createConsentGate(options: ConsentGateOptions): ConsentGate {
  const { publicApi, initConfiguration, mode } = options
  let state: ConsentState = mode === 'ignore' ? 'granted' : 'pending'
  const blockedHandlers: ((name: string) => void)[] = []

  if (mode === 'auto' && initConfiguration && initConfiguration.trackingConsent !== 'granted') {
    // Hold RUM itself, not just this plugin's actions, until the visitor accepts.
    initConfiguration.trackingConsent = 'not-granted'
  }

  return {
    state: () => state,
    isOpen: () => state === 'granted',
    grant(categories?: string[]) {
      if (categories && categories.length > 0) {
        publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.consentCategories, categories.slice().sort())
      }
      if (state === 'granted') return
      state = 'granted'
      publicApi.setTrackingConsent?.('granted')
    },
    deny() {
      if (state === 'not-granted') return
      state = 'not-granted'
      publicApi.setTrackingConsent?.('not-granted')
    },
    onBlocked(handler) {
      blockedHandlers.push(handler)
    },
    notifyBlocked(name) {
      for (const handler of blockedHandlers) handler(name)
    },
  }
}
