import type { ConsentState, RumInitConfigurationLike, RumPublicApi } from '../types.js'
import { GLOBAL_CONTEXT_KEYS } from '../schema/keys.js'

const PAGE_KEY = '__DD_RUM_COMMUNITY_CONSENT__'

/**
 * The consent decisions every plugin on the page shares.
 *
 * It lives on `globalThis` because each CDN bundle carries its own copy of the core: a OneTrust
 * bundle and an engagement bundle loaded side by side have two gates and no other way to agree.
 * Its shape is a contract between plugin versions loaded on the same page, so add fields, never
 * rename or remove one.
 */
export interface PageConsent {
  /** One decision per consent source, keyed by its name (`onetrust`, `shopify`). */
  sources: Record<string, ConsentState>
  /** Called after any source changes its decision. */
  listeners: (() => void)[]
}

export function pageConsent(): PageConsent {
  const scope = globalThis as Record<string, unknown>
  return (scope[PAGE_KEY] ??= { sources: {}, listeners: [] }) as PageConsent
}

/**
 * The most restrictive decision on the page: any `not-granted` wins, then any `pending`.
 * `undefined` when nothing on the page reads a consent signal, which leaves the host page's own
 * `trackingConsent` in charge.
 */
export function pageConsentState(): ConsentState | undefined {
  const states = Object.values(pageConsent().sources)
  if (states.includes('not-granted')) return 'not-granted'
  if (states.includes('pending')) return 'pending'
  return states.length > 0 ? 'granted' : undefined
}

/** Forget every decision, as a new page load would. For tests. */
export function resetPageConsent(): void {
  delete (globalThis as Record<string, unknown>)[PAGE_KEY]
}

/**
 * Holds a plugin's events while consent on the page is pending or refused.
 *
 * Nothing is queued: a declined visitor sends nothing at all, which is why RUM cannot report
 * opt-in rate (see the PRD). Events that arrive while the decision is pending are dropped, not
 * buffered, so a later "granted" never backfills pre-consent activity.
 *
 * A gate with no consent signal of its own follows the page: open unless some consent source on
 * the page says otherwise. Its adapter makes it a source by calling `grant` or `deny`. Only a gate
 * handed `initConfiguration` (a consent plugin, or a host resolver) holds RUM itself and moves the
 * SDK's tracking consent; an adapter never widens or narrows it for the rest of the page.
 */
export interface ConsentGate {
  /** The decision that applies to this plugin right now. */
  state: () => ConsentState
  /** True when events may be sent right now. */
  isOpen: () => boolean
  /** Record a grant from this plugin's consent source. */
  grant: (categories?: string[]) => void
  /** Record a refusal from this plugin's consent source. */
  deny: () => void
}

export interface ConsentGateOptions {
  /**
   * `ignore` opens the gate for good and trusts the host page's own `trackingConsent`.
   * `auto` (default) follows the decisions recorded on the page.
   */
  mode: 'auto' | 'ignore'
  /** The source name this gate records its decisions under. */
  name: string
  publicApi: RumPublicApi
  /**
   * Pass this only from something that owns consent for the page: a consent plugin, or a host
   * resolver. The gate then sets `trackingConsent = 'not-granted'` before RUM starts, the way
   * `shopifyPlugin` rewrites init options, and later sets the SDK's tracking consent to the page's
   * combined decision.
   */
  initConfiguration?: RumInitConfigurationLike
  /** Start as a pending source, for a decision that arrives later (a host resolver). */
  pending?: boolean
}

export function createConsentGate(options: ConsentGateOptions): ConsentGate {
  const { publicApi, initConfiguration, mode, name } = options
  const page = pageConsent()

  const record = (next: ConsentState) => {
    if (mode === 'ignore' || page.sources[name] === next) return
    page.sources[name] = next
    for (const listener of page.listeners.slice()) listener()
  }

  if (mode === 'auto' && initConfiguration) {
    // Hold RUM itself, not just this plugin's actions, until the visitor accepts.
    if (initConfiguration.trackingConsent !== 'granted') initConfiguration.trackingConsent = 'not-granted'
    let applied: ConsentState | undefined
    page.listeners.push(() => {
      const state = pageConsentState()
      if (state && state !== 'pending' && state !== applied) {
        applied = state
        publicApi.setTrackingConsent?.(state)
      }
    })
  }
  if (mode === 'auto' && (initConfiguration || options.pending)) record('pending')

  const state = (): ConsentState => (mode === 'ignore' ? 'granted' : (pageConsentState() ?? 'granted'))

  return {
    state,
    isOpen: () => state() === 'granted',
    grant(categories?: string[]) {
      if (categories && categories.length > 0) {
        publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.consentCategories, categories.slice().sort())
      }
      record('granted')
    },
    deny() {
      record('not-granted')
    },
  }
}
