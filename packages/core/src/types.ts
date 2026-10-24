/**
 * The plugin contract.
 *
 * `RumPlugin` lives in `@datadog/browser-rum-core`, which is internal to the SDK and may change
 * without notice (see the PRD's deferred risks). This file is the single place the whole repo
 * depends on that shape, so a breaking change upstream is one edit here.
 *
 * It is declared structurally rather than imported so the core builds with only
 * `@datadog/browser-rum` as a peer dependency.
 */

/** The subset of the RUM public API that adapters are allowed to call. */
export interface RumPublicApi {
  setUser: (user: { id?: string | undefined; name?: string; email?: string; [key: string]: unknown }) => void
  setUserProperty?: (key: string, value: unknown) => void
  clearUser: () => void
  setAccount?: (account: { id: string; name?: string; [key: string]: unknown }) => void
  clearAccount?: () => void
  setGlobalContextProperty: (key: string, value: unknown) => void
  addAction: (name: string, context?: object) => void
  addError: (error: unknown, context?: object) => void
  startView: (nameOrOptions?: string | { name?: string; service?: string; version?: string }) => void
  setTrackingConsent?: (consent: 'granted' | 'not-granted' | 'pending') => void
}

/** Init options the SDK hands to `onInit`, which a plugin may adjust before RUM starts. */
export interface RumInitConfigurationLike {
  trackingConsent?: 'granted' | 'not-granted' | 'pending'
  trackViewsManually?: boolean
  sessionReplaySampleRate?: number
  trackUserInteractions?: boolean
  trackResources?: boolean
  trackLongTasks?: boolean
  [key: string]: unknown
}

export interface RumPluginOnInitArgs {
  initConfiguration: RumInitConfigurationLike
  publicApi: RumPublicApi
}

/**
 * Structural equivalent of the SDK's `RumPlugin`. `onInit` may be async and may return `false`
 * to opt out, the way the official `shopifyPlugin` does on non-checkout pages.
 */
export interface RumPlugin {
  name: string
  onInit?: (args: RumPluginOnInitArgs) => void | false | Promise<void | false>
  [key: string]: unknown
}

/** Options every adapter accepts, so a settings form can be generated from one shape. */
export interface CommonPluginOptions {
  /** Allow-list of action names (with or without the prefix). Defaults to every action in scope. */
  events?: string[]
  /** Call `setUser` with the platform customer ID. */
  identifyUsers?: boolean
  /** Add the customer email to `setUser`. Off by default. */
  includeEmail?: boolean
  /** Add the customer name to `setUser`. Off by default. */
  includeName?: boolean
  /** Attach `items[]` to commerce actions. Off by default; capped at 20 entries. */
  includeItems?: boolean
  /** Rename the action family prefix if the site has its own convention. */
  actionPrefix?: string
  /** `auto` reads the platform consent API, `ignore` skips the gate, or supply a resolver. */
  consent?: 'auto' | 'ignore' | ConsentResolver
  /** Edit or drop an event before it is sent. Return `false` or `null` to drop it. */
  beforeTrack?: BeforeTrack
  /** Log every mapped event to the console. */
  debug?: boolean
}

export type BeforeTrack = (event: TrackedEvent) => TrackedEvent | false | null | undefined | void

export interface TrackedEvent {
  /** Action name as it will be sent, prefix included. */
  name: string
  /** Attribute object sent as the action context. */
  context: Record<string, unknown>
}

/** A resolver the host page supplies when it owns the consent decision. */
export type ConsentResolver = (notify: (granted: boolean, categories?: string[]) => void) => void | (() => void)

export type ConsentState = 'granted' | 'not-granted' | 'pending'

/** What an adapter declares that it touches, rendered as a permissions screen in the gallery. */
export interface PluginFootprint {
  /** Platform globals read, e.g. `window.wc`, `analytics`. */
  globals: string[]
  /** Platform events subscribed to. */
  events: string[]
  /** `localStorage` / `sessionStorage` keys written. */
  storageKeys: string[]
  /** RUM public API methods called. */
  rumApis: string[]
  /** Where the consent signal comes from, or `null` when the adapter reads none. */
  consentSource: string | null
}
