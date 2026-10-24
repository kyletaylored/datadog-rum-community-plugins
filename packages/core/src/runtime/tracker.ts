import {
  FAMILY_PREFIX,
  GLOBAL_CONTEXT_KEYS,
  SCHEMA_VERSION,
  bareEvent,
  familyNameOf,
  type CustomerType,
} from '../schema/registry.js'
import type {
  CommonPluginOptions,
  PluginFootprint,
  RumInitConfigurationLike,
  RumPublicApi,
  TrackedEvent,
} from '../types.js'
import { createConsentGate, type ConsentGate } from './consentGate.js'
import { createDedupe, type Dedupe } from './dedupe.js'
import { createLogger, type Logger } from './logger.js'
import { sanitizeContext, text } from './sanitize.js'

export interface StoreContext {
  id?: string
  currency?: string
  locale?: string
}

export interface IdentityInput {
  /** The platform or provider customer ID. Always allowed. */
  id: string
  /** Sent only when `includeEmail` is on. */
  email?: string
  /** Sent only when `includeName` is on. */
  name?: string
  /** Extra non-PII properties, e.g. a loyalty tier. Filtered like any attribute. */
  properties?: Record<string, unknown>
}

export interface AccountInput {
  id: string
  name?: string
  properties?: Record<string, unknown>
}

export interface TrackerConfig {
  /** Adapter name, e.g. `woocommerce`. Used in the debug log and as the dedupe namespace. */
  platform: string
  /** The adapter package version, sent as `commerce.plugin_version`. */
  version: string
  publicApi: RumPublicApi
  initConfiguration?: RumInitConfigurationLike
  options?: CommonPluginOptions
  /** What this adapter declares that it touches. */
  footprint: Omit<PluginFootprint, 'storageKeys'> & { storageKeys?: string[] }
  /** Injected in tests. */
  dedupe?: Dedupe
}

export interface Tracker {
  /** Map a schema event to `addAction`, after the allow-list, consent gate, filter and dedupe. */
  track: (event: string, attributes?: Record<string, unknown>) => boolean
  /** `setUser` with the platform customer ID; email and name only when opted in. */
  identify: (identity: IdentityInput) => void
  /** `setAccount`, for B2B storefronts and multi-tenant apps. */
  identifyAccount: (account: AccountInput) => void
  /** `clearUser` on logout. */
  clearIdentity: () => void
  setStore: (store: StoreContext) => void
  setCustomerType: (type: CustomerType) => void
  consent: ConsentGate
  logger: Logger
  /** The footprint with storage keys filled in, printed in debug mode. */
  footprint: PluginFootprint
  /** Resolved options, after defaults. */
  options: Required<Pick<CommonPluginOptions, 'identifyUsers' | 'includeEmail' | 'includeName' | 'includeItems' | 'actionPrefix' | 'debug'>> &
    CommonPluginOptions
}

const DEFAULTS = {
  identifyUsers: true,
  includeEmail: false,
  includeName: false,
  includeItems: false,
  actionPrefix: 'commerce.',
  debug: false,
} as const

/**
 * Builds the pipeline every adapter sends through. The adapter only maps platform payloads onto
 * schema events; the allow-list, consent gate, PII filter, size caps, dedupe, `beforeTrack` hook
 * and debug log all live here, so a new adapter inherits them without writing any of it.
 */
export function createTracker(config: TrackerConfig): Tracker {
  const raw = config.options ?? {}
  const options = { ...DEFAULTS, ...raw }
  const logger = createLogger(config.platform, options.debug === true)

  const consentMode = typeof raw.consent === 'function' ? 'auto' : (raw.consent ?? 'auto')
  const consent = createConsentGate({
    mode: consentMode === 'ignore' ? 'ignore' : 'auto',
    publicApi: config.publicApi,
    initConfiguration: config.initConfiguration,
  })

  // A host-supplied resolver owns the decision when one is passed as `consent`.
  if (typeof raw.consent === 'function') {
    raw.consent((granted, categories) => (granted ? consent.grant(categories) : consent.deny()))
  }

  const dedupe =
    config.dedupe ??
    createDedupe({ namespace: config.platform })

  const footprint: PluginFootprint = {
    ...config.footprint,
    storageKeys: [...(config.footprint.storageKeys ?? []), ...dedupe.storageKeys],
  }

  // Identity context is cached so a later opt-in or a late login doesn't lose what we already saw.
  let currentCustomerType: CustomerType | undefined

  const prefix = options.actionPrefix
  // The allow-list accepts prefixed or bare names, so `events: ['purchase']` works too.
  const allowed = options.events?.map(bareEvent)

  config.publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.platform, config.platform)
  config.publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.pluginVersion, config.version)
  config.publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.schemaVersion, SCHEMA_VERSION)

  if (logger.enabled) {
    logger.info('footprint', footprint)
    logger.info(`schema ${SCHEMA_VERSION}, consent ${consent.state()}`)
  }

  function track(event: string, attributes: Record<string, unknown> = {}): boolean {
    const bare = bareEvent(event)
    const family = familyNameOf(bare)

    if (!family) {
      logger.dropped(bare, 'not in the schema')
      return false
    }

    if (allowed && !allowed.includes(bare)) {
      logger.dropped(bare, 'not in the events allow-list')
      return false
    }

    if (!consent.isOpen()) {
      consent.notifyBlocked(bare)
      logger.dropped(bare, `consent ${consent.state()}`)
      return false
    }

    // Commerce keeps the configurable prefix; other families keep their own, so renaming
    // `commerce.` never silently renames `account.login`.
    const name = family === 'commerce' ? `${prefix}${bare}` : `${FAMILY_PREFIX[family]}${bare}`

    let context = sanitizeContext(attributes)

    if (!options.includeItems) delete context.items

    if (bare === 'purchase') {
      const transactionId = text(context.transaction_id)
      if (!transactionId) {
        logger.dropped(bare, 'no transaction_id, cannot deduplicate revenue')
        return false
      }
      if (!dedupe.claim(transactionId)) {
        logger.dropped(bare, `already counted for transaction ${transactionId}`)
        return false
      }
    }

    if (raw.beforeTrack) {
      const candidate: TrackedEvent = { name, context }
      let edited: ReturnType<typeof raw.beforeTrack>
      try {
        edited = raw.beforeTrack(candidate)
      } catch (error) {
        logger.warn('beforeTrack threw, sending the event unchanged', error)
        edited = candidate
      }
      if (edited === false || edited === null) {
        logger.dropped(bare, 'dropped by beforeTrack')
        return false
      }
      if (edited && typeof edited === 'object') {
        // Re-filter: a hook must not be able to reintroduce a blocked key.
        context = sanitizeContext(edited.context ?? context)
        if (!options.includeItems) delete context.items
      }
    }

    logger.event(name, context)
    config.publicApi.addAction(name, context)
    return true
  }

  function identify(identity: IdentityInput): void {
    if (options.identifyUsers === false) {
      logger.dropped('setUser', 'identifyUsers is off')
      return
    }
    // Identity is held by the same gate as actions: nothing about the visitor is sent before
    // they accept, and a later grant does not backfill it.
    if (!consent.isOpen()) {
      consent.notifyBlocked('setUser')
      logger.dropped('setUser', `consent ${consent.state()}`)
      return
    }
    const id = text(identity.id)
    if (!id) return

    const user: Record<string, unknown> = { id, ...sanitizeContext(identity.properties ?? {}) }
    if (options.includeEmail && identity.email) {
      const email = text(identity.email)
      if (email) user.email = email
    }
    if (options.includeName && identity.name) {
      const name = text(identity.name)
      if (name) user.name = name
    }

    logger.info('setUser', user)
    config.publicApi.setUser(user as { id: string })
  }

  function identifyAccount(account: AccountInput): void {
    if (options.identifyUsers === false) return
    if (!consent.isOpen()) {
      consent.notifyBlocked('setAccount')
      logger.dropped('setAccount', `consent ${consent.state()}`)
      return
    }
    const id = text(account.id)
    if (!id || !config.publicApi.setAccount) return

    const payload: Record<string, unknown> = { id, ...sanitizeContext(account.properties ?? {}) }
    if (options.includeName && account.name) {
      const name = text(account.name)
      if (name) payload.name = name
    }

    logger.info('setAccount', payload)
    config.publicApi.setAccount(payload as { id: string })
  }

  function clearIdentity(): void {
    logger.info('clearUser')
    config.publicApi.clearUser()
    config.publicApi.clearAccount?.()
  }

  function setStore(store: StoreContext): void {
    const id = text(store.id)
    const currency = text(store.currency)
    const locale = text(store.locale)
    if (id) config.publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.storeId, id)
    if (currency) config.publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.storeCurrency, currency.toUpperCase())
    if (locale) config.publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.storeLocale, locale)
  }

  function setCustomerType(type: CustomerType): void {
    if (currentCustomerType === type) return
    currentCustomerType = type
    config.publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.customerType, type)
  }

  return {
    track,
    identify,
    identifyAccount,
    clearIdentity,
    setStore,
    setCustomerType,
    consent,
    logger,
    footprint,
    options,
  }
}
